const ethers = require('ethers');
const mysql = require('mysql2/promise');

// Ethereum contract configuration
// const provider = 'https://methodical-rough-snowflake.blast-mainnet.quiknode.pro/9121571503a4a27b665ce17aea5c5289f1542040/';
const provider = new ethers.providers.JsonRpcProvider('RPC_PROVIDER');

const contractAddress = '0x0000000000E14E87e5c80A8A90817308fFF715d3';
const abi = [
  "event RandomnessRequested(uint256 roundId, uint256 requestId)",
  "function getRound(uint256 roundId) external view returns (uint8 status, uint40 maximumNumberOfParticipants, uint16 roundProtocolFeeBp, uint40 cutoffTime, uint40 drawnAt, uint40 numberOfParticipants, address winner, uint96 roundValuePerEntry, uint256 protocolFeeOwed, tuple(uint256, uint256, uint256, uint256, address, bool, uint256)[] deposits)",
  "function randomnessRequests(uint256 requestId) external view returns (bool exists, uint40 roundId, uint256 randomWord)"
];

const contractYolo = new ethers.Contract(contractAddress, abi, provider);

// MySQL database configuration
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

async function insertIntoPrizeUpdate(data) {
  const query = `INSERT INTO prize_update (roundId, requestId, randomWord, lastExtra, remainder, winner) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
  try {
    await executeQuery(query, data);
  } catch (error) {
    console.error('Error inserting data into prize_update:', error);
    throw error;
  }
}

async function insertIntoCostUpdate(data) {
  const query = `INSERT INTO cost_update (roundId, wallet, bets) 
                 VALUES (?, ?, ?)`;
  try {
    await executeQuery(query, data);
  } catch (error) {
    console.error('Error inserting data into cost_update:', error);
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
      if (!missingRounds.includes(i) && !lostRounds.includes(i) && !canceledRounds.includes(i)) {
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
        missingRounds.push(roundId);  // If an error occurs, add the round back to missingRounds
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

    const lastDeposit = processedDeposits[processedDeposits.length - 1];
    const lastExtra = ethers.BigNumber.from(lastDeposit[2]);

    const remainder = randomWord.mod(lastExtra);

    let closestDeposit = null;
    let closestDiff = lastExtra;

    for (let deposit of processedDeposits) {
      const currentExtra = ethers.BigNumber.from(deposit[2]);
      const currentDiff = currentExtra.sub(remainder);

      if (currentDiff.gt(0) && currentDiff.lte(closestDiff)) {
        closestDeposit = deposit;
        closestDiff = currentDiff;
      }
    }

    let winnerAddress = '';
    if (closestDeposit) {
      const [, winnerAddr] = closestDeposit;
      winnerAddress = winnerAddr;
    }

    // Insert data into prize_update table
    const prizeData = [
      roundId.toString(),
      requestId.toString(),
      randomWord.toString(),
      (lastExtra.toNumber() * 0.01).toFixed(4),
      remainder.toString(),
      winnerAddress
    ];
    await insertIntoPrizeUpdate(prizeData);

    // Process and insert data into cost_update table
    let previousExtra = ethers.BigNumber.from(0);
    for (let deposit of processedDeposits) {
      const [, wallet, extra] = deposit;
      const currentExtra = ethers.BigNumber.from(extra);
      const bet = currentExtra.sub(previousExtra);
      const betValue = (bet.toNumber() * 0.01).toFixed(4);
      
      const costData = [roundId.toString(), wallet, betValue];
      await insertIntoCostUpdate(costData);

      previousExtra = currentExtra;
    }

    console.log('Data processing complete.');
    console.log('-'.repeat(50)); 
    console.log('\n');

    // Print round status after processing
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
