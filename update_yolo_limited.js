const ethers = require('ethers');
const mysql = require('mysql2/promise');

// WebSocket provider configuration
const provider = new ethers.providers.JsonRpcProvider('RPC_PROVIDER');

// Contract configuration
const contractAddress = '0x28EF3eaE1AbB6D6e22e9bFc7a0944f707E4726b3';
const abi = [
  "event RandomnessRequested(uint256 roundId, uint256 requestId)",
  "function getRound(uint256 roundId) external view returns (uint8 status, uint40 maximumNumberOfParticipants, uint16 roundProtocolFeeBp, uint40 cutoffTime, uint40 drawnAt, uint40 numberOfParticipants, address winner, uint96 roundValuePerEntry, uint256 protocolFeeOwed, tuple(uint256, uint256, uint256, uint256, address, bool, uint256)[] deposits)",
  "function randomnessRequests(uint256 requestId) external view returns (bool exists, uint40 roundId, uint256 randomWord)"
];
const contractYolo = new ethers.Contract(contractAddress, abi, provider);

// MySQL configuration
const dbConfig = {
  host: 'DB_HOST',
  user: 'DB_USER',
  password: 'DB_PASS',
  database: 'DB_DATABASE',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
};

let lastProcessedRoundId = 0;
let missingRounds = [];
let lostRounds = [];
let canceledRounds = [];

let pool;

async function createPool() {
  try {
    pool = mysql.createPool(dbConfig);
    console.log('Connection pool created successfully');
  } catch (error) {
    console.error('Error creating connection pool:', error);
    throw error;
  }
}

async function getConnection() {
  try {
    return await pool.getConnection();
  } catch (error) {
    console.error('Error getting connection from pool:', error);
    throw error;
  }
}

async function executeQuery(query, params, retries = 3) {
  let connection;
  try {
    connection = await getConnection();
    return await connection.query(query, params);
  } catch (error) {
    if (retries > 0) {
      console.log(`Query failed. Retrying... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return executeQuery(query, params, retries - 1);
    } else {
      throw error;
    }
  } finally {
    if (connection) connection.release();
  }
}

async function insertLimitedPrize(data) {
  const query = `
    INSERT INTO limited_prize (roundId, requestId, randomWord, lastExtra, remainder, winner)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  try {
    await executeQuery(query, data);
  } catch (error) {
    console.error('Error inserting data into limited_prize:', error);
    throw error;
  }
}

async function insertLimitedCost(data) {
  const query = `
    INSERT INTO limited_cost (roundId, wallet, bets)
    VALUES (?, ?, ?)
  `;
  try {
    await executeQuery(query, data);
  } catch (error) {
    console.error('Error inserting data into limited_cost:', error);
    throw error;
  }
}

async function getValidRandomWord(requestId, retryDelay = 1000) {
  while (true) {
    const randomnessRequestData = await contractYolo.randomnessRequests(requestId);
    const [, , randomWord] = randomnessRequestData;

    if (randomWord && !randomWord.isZero()) {
      return randomWord;
    }

    console.log(`Invalid randomWord. Retrying in ${retryDelay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, retryDelay));
  }
}

function checkMissingRounds(currentRoundId) {
  if (lastProcessedRoundId > 0) {
    for (let i = lastProcessedRoundId + 1; i < currentRoundId; i++) {
      if (!missingRounds.includes(i)) {
        missingRounds.push(i);
      }
    }
  }
  lastProcessedRoundId = currentRoundId;
}

async function processMissingRounds() {
  if (missingRounds.length >= 20) {
    const roundsToProcess = missingRounds.splice(0, 20);
    for (const roundId of roundsToProcess) {
      try {
        const roundData = await contractYolo.getRound(roundId);
        if (roundData.deposits.length === 1) {
          canceledRounds.push(roundId);
        } else {
          lostRounds.push(roundId);
        }
      } catch (error) {
        console.error(`Error processing round ${roundId}:`, error);
        // If an error occurs, put the round back into missingRounds
        missingRounds.push(roundId);
      }
    }
  }
}

function printRoundStatus() {
  console.log("Missing rounds:", missingRounds.join(", "));
  console.log("Lost rounds:", lostRounds.join(", "));
  console.log("Canceled rounds:", canceledRounds.join(", "));
}

async function processEvent(roundId, requestId) {
  console.log(`New event: roundId: ${roundId}, requestId: ${requestId}`);

  checkMissingRounds(roundId.toNumber());
  await processMissingRounds();

  try {
    const roundData = await contractYolo.getRound(roundId);
    const processedDeposits = roundData.deposits.map(deposit => {
      const [, , , amount, address, , extra] = deposit;
      return [ethers.utils.formatEther(amount), address, extra.toString()];
    });

    const randomWord = await getValidRandomWord(requestId);
    console.log("Valid randomWord obtained:", randomWord.toString());

    const lastDeposit = processedDeposits[processedDeposits.length - 1];
    const lastExtra = ethers.BigNumber.from(lastDeposit[2]);

    const remainder = randomWord.mod(lastExtra);
    console.log("Remainder:", remainder.toString());

    let closestDeposit = null;
    let closestDiff = lastExtra;

    for (let deposit of processedDeposits) {
      const [, , extraStr] = deposit;
      const currentExtra = ethers.BigNumber.from(extraStr);
      const currentDiff = currentExtra.sub(remainder);

      if (currentDiff.gt(0) && currentDiff.lte(closestDiff)) {
        closestDeposit = deposit;
        closestDiff = currentDiff;
      }
    }

    let winnerAddress = '';
    if (closestDeposit) {
      const [, winnerAddr] = closestDeposit;
      console.log(`Winner: ${winnerAddr}`);
      winnerAddress = winnerAddr;
    }

    // Insert into limited_prize table
    const prizeData = [
      roundId.toString(),
      requestId.toString(),
      randomWord.toString(),
      (lastExtra.toNumber() * 0.001).toFixed(4),
      remainder.toString(),
      winnerAddress
    ];
    await insertLimitedPrize(prizeData);

    // Process and insert into limited_cost table
    let previousExtra = ethers.BigNumber.from(0);
    for (let deposit of processedDeposits) {
      const [, wallet, extraStr] = deposit;
      const currentExtra = ethers.BigNumber.from(extraStr);
      const bets = currentExtra.sub(previousExtra);
      const costData = [
        roundId.toString(),
        wallet,
        (bets.toNumber() * 0.001).toFixed(4)
      ];
      await insertLimitedCost(costData);
      previousExtra = currentExtra;
    }

    console.log("Data insertion completed");
    console.log("------------------");
    console.log();

    printRoundStatus();

  } catch (error) {
    console.error(`Error processing event for roundId ${roundId}, requestId ${requestId}:`, error);
  }
}

async function monitorRealTimeEvents() {
  await createPool();

  contractYolo.on('RandomnessRequested', async (roundId, requestId) => {
    await processEvent(roundId, requestId);
  });

  console.log("Real-time event monitoring started...");
}

async function main() {
  try {
    await monitorRealTimeEvents();
  } catch (error) {
    console.error('Error in main function:', error);
    process.exit(1);
  }
}

main();
