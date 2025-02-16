const ethers = require('ethers');
const mysql = require('mysql2/promise');

// Set up provider
const provider = new ethers.providers.JsonRpcProvider('RPC_PROVIDER');

// Contract addresses and ABIs
const contracts = [
    {
        name: 'Flipper',
        address: '0x96648d17c273A932197aCF2232653Bed7D69EC6f',
        abi: [
            "event Flipper__GameCreated(uint256 blockNumber, address player, uint256 numberOfRounds, uint256 playAmountPerRound, address currency, int256 stopGain, int256 stopLoss, bool isGold)",
            "event Flipper__GameCompleted(uint256 blockNumber, address player, bool[] results, uint256[] payouts, uint256 numberOfRoundsPlayed, uint256 protocolFee, uint256 liquidityPoolFee)"
        ],
        dbTable: 'flipper_events'
    },
    {
        name: 'LaserBlast',
        address: '0xc6f17f7935B12a38fe4a80f4f4Db7DBaf324224c',
        abi: [
            "event LaserBlast__GameCreated(uint256 blockNumber, address player, uint256 numberOfRounds, uint256 playAmountPerRound, address currency, int256 stopGain, int256 stopLoss, uint256 riskLevel, uint256 rowCount)",
            "event LaserBlast__GameCompleted(uint256 blockNumber, address player, uint256[] results, uint256[] payouts, uint256 numberOfRoundsPlayed, uint256 protocolFee, uint256 liquidityPoolFee)"
        ],
        dbTable: 'laserblast_events'
    },
    {
        name: 'Quantum',
        address: '0xA596f7D6587DE656d0Ef099d2F28fe699060BF97',
        abi: [
            "event Quantum__GameCreated(uint256 blockNumber, address player, uint256 numberOfRounds, uint256 playAmountPerRound, address currency, int256 stopGain, int256 stopLoss, bool isAbove, uint256 multiplier)",
            "event Quantum__GameCompleted(uint256 blockNumber, address player, uint256[] results, uint256[] payouts, uint256 numberOfRoundsPlayed, uint256 protocolFee, uint256 liquidityPoolFee)"
        ],
        dbTable: 'quantum_events'
    }
];

// Uniform columns for all tables
const uniformColumns = ['block_number', 'player', 'eth', 'yolo', 'transaction_hash'];

// MySQL connection configuration
const dbConfig = {
    host: 'DB_HOST',
    user: 'DB_USER',
    password: 'DB_PASS',
    database: 'DB_DATABASE'
};

// Create connection pool
const pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 10,
    queueLimit: 0
});

// Create contract instances
const contractInstances = contracts.map(contract => ({
    ...contract,
    instance: new ethers.Contract(contract.address, contract.abi, provider)
}));

async function saveToDatabase(contract, event) {
    let connection;
    try {
        connection = await pool.getConnection();

        const { blockNumber, player, numberOfRounds, playAmountPerRound, currency } = event.args;
        const transactionHash = event.transactionHash;

        const totalAmount = numberOfRounds.mul(playAmountPerRound);
        let ethAmount = '0';
        let yoloAmount = '0';

        if (currency.toLowerCase() === '0x0000000000000000000000000000000000000000') {
            ethAmount = ethers.utils.formatEther(totalAmount);
        } else if (currency.toLowerCase() === '0xf77dd21c5ce38ac08786be35ef1d1dec1a6a15f3') {
            yoloAmount = ethers.utils.formatEther(totalAmount);
        }

        const rowData = [blockNumber.toString(), player, ethAmount, yoloAmount, transactionHash];

        const query = `INSERT INTO ${contract.dbTable} (${uniformColumns.join(', ')}) VALUES (?, ?, ?, ?, ?)`;
        await connection.execute(query, rowData);
        console.log(`Added new ${contract.name}__GameCreated event to database: Block ${blockNumber}, Player ${player}`);

    } catch (error) {
        console.error(`Error saving to database for ${contract.name}:`, error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

async function listenToEvents() {
    for (const contract of contractInstances) {
        console.log(`Starting to listen for ${contract.name} events...`);

        contract.instance.on(`${contract.name}__GameCreated`, async (...args) => {
            const event = args[args.length - 1];
            console.log(`${contract.name}__GameCreated event triggered:`, event.transactionHash);
            await saveToDatabase(contract, event);
            console.log(`${contract.name}__GameCreated event processing completed`);
            console.log('-----------------------------------------------------------------');
            console.log('\n');
        });

        // We're not processing GameCompleted events
    }

    console.log('All event listeners set up, waiting for new events...');
}

listenToEvents().catch(error => {
    console.error('An error occurred:', error);
});

// Close the connection pool when the script exits
process.on('SIGINT', async () => {
    console.log('Closing connection pool...');
    await pool.end();
    process.exit(0);
});