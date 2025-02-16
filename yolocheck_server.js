const express = require('express');
const app = express();
const { ethers } = require('ethers');
const port = 3000;
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2');
const pool = require('./db'); // Assuming you have configured the database connection pool in db.js
const provider = new ethers.providers.JsonRpcProvider('https://rpc.blast.io'); // Blast Network RPC
const contractAddress = '0x0000000000E14E87e5c80A8A90817308fFF715d3';
const limitedContractAddress = '0x28EF3eaE1AbB6D6e22e9bFc7a0944f707E4726b3';
const cron = require('node-cron');

const abi = [
    "function getRound(uint256 roundId) external view returns (uint8 status, uint40 maximumNumberOfParticipants, uint16 roundProtocolFeeBp, uint40 cutoffTime, uint40 drawnAt, uint40 numberOfParticipants, address winner, uint96 roundValuePerEntry, uint256 protocolFeeOwed, tuple(uint256, uint256, uint256, uint256, address, bool, uint256)[] deposits)"
];
const contract = new ethers.Contract(contractAddress, abi, provider);
const limitedContract = new ethers.Contract(limitedContractAddress, abi, provider);

const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// When accessing the root path, return test.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

// (Provider is already set above)

// Handle user registration
app.post('/sign-up', async (req, res) => {
    const { username, email, password, walletAddress } = req.body;

    if (!username || !email || !password || !walletAddress) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    try {
        // Check if username and wallet address are unique
        const [userRows] = await pool.query('SELECT * FROM users WHERE username = ? OR wallet_address = ?', [username, walletAddress]);

        if (userRows.length > 0) {
            return res.status(400).json({ success: false, message: 'Username or wallet address already in use' });
        }

        // Check subscription status
        const [subscriptionRows] = await pool.query('SELECT * FROM subscriptions WHERE wallet_address = ?', [walletAddress]);

        if (subscriptionRows.length === 0 || new Date(subscriptionRows[0].expire_date) < new Date()) {
            return res.status(400).json({ success: false, message: 'Please subscribe with your wallet first' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        await pool.query('INSERT INTO users (username, email, password, wallet_address) VALUES (?, ?, ?, ?)', [username, email, hashedPassword, walletAddress]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error during sign-up:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Handle user login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
  
    try {
      // Query user
      const [userRows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
      if (userRows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid username or password' });
      }
  
      const user = userRows[0];
  
      // Verify password
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(400).json({ success: false, message: 'Invalid username or password' });
      }
  
      // After successful login, query subscription expiration date
      const [subscriptionRows] = await pool.query('SELECT expire_date FROM subscriptions WHERE wallet_address = ?', [user.wallet_address]);
  
      let expireDate = null;
      if (subscriptionRows.length > 0) {
        expireDate = subscriptionRows[0].expire_date;
      }
  
      // Return information upon successful login, including expireDate field
      res.json({ 
        success: true, 
        walletAddress: user.wallet_address,
        expireDate: expireDate  // If null, it indicates no subscription information
      });
    } catch (error) {
      console.error('Error during login:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
});
  
// Check subscription status for a given username
app.get('/check-user-subscription', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
    }

    try {
        // Query user
        const [userRows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const walletAddress = userRows[0].wallet_address;

        // Query subscription information
        const [subscriptionRows] = await pool.query('SELECT * FROM subscriptions WHERE wallet_address = ?', [walletAddress]);

        if (subscriptionRows.length > 0) {
            const subscription = subscriptionRows[0];
            const now = new Date();

            // Check if expired
            if (new Date(subscription.expire_date) > now) {
                return res.json({ success: true, valid: true });
            } else {
                return res.json({ success: true, valid: false, message: 'Subscription expired' });
            }
        } else {
            return res.json({ success: true, valid: false, message: 'No subscription found' });
        }
    } catch (error) {
        console.error('Error checking user subscription:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Forgot password
const crypto = require('crypto'); // Used to generate random token
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    try {
        // Query user
        const [userRows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Email not found' });
        }

        const user = userRows[0];

        // Generate random token
        const token = crypto.randomBytes(32).toString('hex');
        const expireTime = new Date(Date.now() + 600000); // Expires in 10 minutes

        // Update user's reset token and expiration time
        await pool.query('UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE email = ?', [token, expireTime, email]);

        // Construct reset password link
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;

        // Send email
        const mailOptions = {
            from: 'nftdaydreamer@gmail.com',
            to: email,
            subject: 'Password Reset',
            text: `Hello,\n\nPlease click the following link to reset your password:\n\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not request this, please ignore this email.\n`
        };

        transporter.sendMail(mailOptions, function(error, info){
            if (error) {
                console.error('Error sending email:', error);
                res.status(500).json({ success: false, message: 'Failed to send email' });
            } else {
                res.json({ success: true, message: 'An email has been sent to reset your password.' });
            }
        });
    } catch (error) {
        console.error('Error during password reset:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ success: false, message: 'Token and password are required' });
    }

    try {
        // Query user
        const [userRows] = await pool.query('SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > ?', [token, new Date()]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid or expired token' });
        }

        const user = userRows[0];

        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update user password and clear reset token and expiration time
        await pool.query('UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?', [hashedPassword, user.id]);

        res.json({ success: true, message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/reset-password', (req, res) => {
    const token = req.query.token;

    if (!token) {
        return res.status(400).send('Invalid or missing token');
    }

    // Send the HTML page for resetting password
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// Execute task every 2 minutes
cron.schedule('*/2 * * * *', async () => {
    try {
        // Retrieve the lastExtra value (Y) from the row with the maximum roundId in the prize_update table
        const [rows] = await pool.query('SELECT lastExtra FROM prize_update ORDER BY roundId DESC LIMIT 1');

        if (rows.length === 0) {
            console.log('No data in prize_update table.');
            return;
        }

        const Y = parseFloat(rows[0].lastExtra);

        // Query all users who have set a threshold that is less than or equal to Y
        const [users] = await pool.query(
            'SELECT email, notification_threshold FROM users WHERE notification_threshold IS NOT NULL AND notification_threshold <= ?',
            [Y]
        );

        if (users.length === 0) {
            console.log('No users to notify.');
            return;
        }

        // Iterate through users and send email
        for (const user of users) {
            const email = user.email;
            const threshold = user.notification_threshold;

            // Send email
            const mailOptions = {
                from: 'nftdaydreamer@gmail.com',
                to: email,
                subject: 'Pot Size Notification',
                text: `Hello,\n\nThe pot of the last spin has reached ${Y} ETH, which is above your set threshold of ${threshold} ETH.\n\nBest regards,\nYOLO Check`
            };

            transporter.sendMail(mailOptions, async (error, info) => {
                if (error) {
                    console.error(`Error sending email to ${email}:`, error);
                } else {
                    console.log(`Email sent to ${email}: ${info.response}`);

                    // After successful email, clear the user's threshold setting to avoid duplicate notifications
                    // await pool.query('UPDATE users SET notification_threshold = NULL WHERE email = ?', [email]);
                }
            });
        }
    } catch (error) {
        console.error('Error in notification cron job:', error);
    }
});

// API to get account information
app.get('/account-info', async (req, res) => {
    const walletAddress = req.query.walletAddress;

    if (!walletAddress) {
        console.error('No wallet address provided');
        return res.status(400).json({ success: false, message: 'Wallet address is required' });
    }

    try {
        console.log(`Fetching subscription info for wallet: ${walletAddress}`);

        // Query subscription information
        const [subscriptionRows] = await pool.query('SELECT * FROM subscriptions WHERE wallet_address = ?', [walletAddress]);

        if (subscriptionRows.length > 0) {
            const subscription = subscriptionRows[0];

            // Query transaction records
            const [transactionRows] = await pool.query(
                'SELECT * FROM subscription_transactions WHERE wallet_address = ? ORDER BY time DESC',
                [walletAddress]
            );

            res.json({
                success: true,
                expireDate: subscription.expire_date,
                transactions: transactionRows,
            });
        } else {
            console.warn(`No subscription found for wallet: ${walletAddress}`);
            res.json({ success: false, message: 'No subscription found for this wallet' });
        }
    } catch (error) {
        console.error('Error fetching account info:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

app.get('/check-user-by-wallet', async (req, res) => {
    const { walletAddress } = req.query;

    if (!walletAddress) {
        return res.status(400).json({ isSignedUp: false, message: 'Wallet address is required' });
    }

    try {
        const [userRows] = await pool.query('SELECT * FROM users WHERE wallet_address = ?', [walletAddress]);
        if (userRows.length > 0) {
            res.json({ isSignedUp: true });
        } else {
            res.json({ isSignedUp: false });
        }
    } catch (error) {
        console.error('Error checking user by wallet:', error);
        res.status(500).json({ isSignedUp: false, message: 'Server error' });
    }
});

app.get('/get-username-by-wallet', async (req, res) => {
    const { walletAddress } = req.query;

    if (!walletAddress) {
        return res.status(400).json({ success: false, message: 'Wallet address is required' });
    }

    try {
        const [userRows] = await pool.query('SELECT username FROM users WHERE wallet_address = ?', [walletAddress]);
        if (userRows.length > 0) {
            res.json({ success: true, username: userRows[0].username });
        } else {
            res.json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error getting username by wallet:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// API to handle subscription
app.post('/subscribe', async (req, res) => {
    const { txHash, walletAddress, amount, duration } = req.body;

    if (!txHash || !walletAddress || !amount || !duration) {
        return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    try {
        // Wait for transaction confirmation (1 confirmation, timeout 60 seconds)
        const receipt = await provider.waitForTransaction(txHash, 1, 60000);

        if (receipt && receipt.status === 1) {
            // Get current time
            const now = new Date();
            let expireDate;

            // Check if there is an existing subscription record for this wallet address in the database
            const [rows] = await pool.query('SELECT * FROM subscriptions WHERE wallet_address = ?', [walletAddress]);

            if (rows.length > 0) {
                // If a subscription record exists, check the current expiration date
                const currentExpireDate = new Date(rows[0].expire_date);

                // If the current expiration date is in the future, add the duration to it; otherwise, start from the current time
                if (currentExpireDate > now) {
                    expireDate = new Date(currentExpireDate.getTime() + duration * 24 * 60 * 60 * 1000);
                } else {
                    expireDate = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);
                }

                // Update expiration date
                await pool.query('UPDATE subscriptions SET expire_date = ? WHERE wallet_address = ?', [expireDate, walletAddress]);
            } else {
                // If no subscription record exists, set expiration date as current time plus subscription duration
                expireDate = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);

                // Insert a new subscription record
                await pool.query('INSERT INTO subscriptions (wallet_address, expire_date) VALUES (?, ?)', [walletAddress, expireDate]);
            }

            // Insert transaction record
            await pool.query(
                'INSERT INTO subscription_transactions (wallet_address, tx_hash, amount, time) VALUES (?, ?, ?, ?)',
                [walletAddress, txHash, amount, now]
            );

            res.json({ success: true, expireDate });
        } else {
            res.status(400).json({ success: false, message: 'Transaction failed' });
        }
    } catch (error) {
        console.error('Error processing subscription:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/get-notification-threshold', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
    }

    try {
        const [rows] = await pool.query('SELECT notification_threshold FROM users WHERE username = ?', [username]);

        if (rows.length > 0) {
            res.json({ success: true, threshold: rows[0].notification_threshold });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error fetching notification threshold:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/set-notification-threshold', async (req, res) => {
    const { username, threshold } = req.body;

    if (!username || threshold === undefined) {
        return res.status(400).json({ success: false, message: 'Username and threshold are required' });
    }

    try {
        await pool.query('UPDATE users SET notification_threshold = ? WHERE username = ?', [threshold, username]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error setting notification threshold:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/check-wallet-2', async (req, res) => {
    const { wallet } = req.body;
    if (!wallet) {
        return res.status(400).send('Wallet address is required');
    }

    try {
        const [prizeResults] = await pool.query('SELECT SUM(lastExtra) AS total_pool FROM prize_update WHERE winner = ?', [wallet]);
        const [costResults] = await pool.query('SELECT SUM(bets) AS total_bets FROM cost_update WHERE wallet = ?', [wallet]);

        const [topWinnings] = await pool.query(
            'SELECT roundId, CAST(lastExtra AS DECIMAL(10,2)) AS winnings FROM prize_update WHERE winner = ? ORDER BY lastExtra DESC LIMIT 10',
            [wallet]
        );

        res.json({ prizeResults, costResults, topWinnings });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.get('/check-subscription', async (req, res) => {
    const walletAddress = req.query.walletAddress;

    if (!walletAddress) {
        return res.status(400).json({ success: false, message: 'Wallet address is required' });
    }

    try {
        // Query subscription information for this wallet address
        const [rows] = await pool.query('SELECT * FROM subscriptions WHERE wallet_address = ?', [walletAddress]);

        if (rows.length > 0) {
            const subscription = rows[0];
            const now = new Date();

            // Check if expired
            if (new Date(subscription.expire_date) > now) {
                return res.json({ success: true, valid: true });
            } else {
                return res.json({ success: true, valid: false, message: 'Subscription expired' });
            }
        } else {
            return res.json({ success: true, valid: false, message: 'No subscription found' });
        }
    } catch (error) {
        console.error('Error checking subscription:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/check-recent-pnl', async (req, res) => {
  const { wallet, rounds } = req.body;
  if (!wallet || !rounds) {
      return res.status(400).send('Wallet address and number of rounds are required');
  }

  try {
      // Get the latest roundId
      const [latestRound] = await pool.query('SELECT MAX(roundId) as maxRoundId FROM prize_update');
      const maxRoundId = latestRound[0].maxRoundId;

      // Calculate the starting roundId
      const startRoundId = Math.max(1, maxRoundId - rounds + 1);

      const [prizeResults] = await pool.query(
          'SELECT SUM(lastExtra) AS total_pool FROM prize_update WHERE winner = ? AND roundId BETWEEN ? AND ?',
          [wallet, startRoundId, maxRoundId]
      );

      const [costResults] = await pool.query(
          'SELECT SUM(bets) AS total_bets FROM cost_update WHERE wallet = ? AND roundId BETWEEN ? AND ?',
          [wallet, startRoundId, maxRoundId]
      );

      res.json({ 
          prizeResults, 
          costResults, 
          roundsChecked: maxRoundId - startRoundId + 1 
      });
  } catch (error) {
      console.error(error);
      res.status(500).send('Server error');
  }
});

app.get('/top-20-main-winner', async (req, res) => {
    await getTop20(res, 'main', 'winner');
});

app.get('/top-20-main-underwater', async (req, res) => {
    await getTop20(res, 'main', 'underwater');
});

app.get('/top-20-limited-winner', async (req, res) => {
    await getTop20(res, 'limited', 'winner');
});

app.get('/top-20-limited-underwater', async (req, res) => {
    await getTop20(res, 'limited', 'underwater');
});

async function getTop20(res, wheelType, resultType) {
    try {
        console.log(`Fetching top 20 ${wheelType} ${resultType}...`);
        
        const prizeTable = wheelType === 'main' ? 'prize_update' : 'limited_prize';
        const costTable = wheelType === 'main' ? 'cost_update' : 'limited_cost';
        const orderDirection = resultType === 'winner' ? 'DESC' : 'ASC';
        const netCondition = resultType === 'winner' ? '> 0' : '< 0';

        const query = `
            WITH RECURSIVE round_range AS (
                SELECT 
                    GREATEST(
                        (SELECT MAX(roundId) - 599 FROM ${costTable}),
                        (SELECT MAX(roundId) - 599 FROM ${prizeTable})
                    ) AS start_round,
                    GREATEST(
                        (SELECT MAX(roundId) FROM ${costTable}),
                        (SELECT MAX(roundId) FROM ${prizeTable})
                    ) AS end_round
            ),
            total_bets AS (
                SELECT 
                    wallet,
                    SUM(bets) AS total_bets
                FROM ${costTable} c
                JOIN round_range r ON c.roundId BETWEEN r.start_round AND r.end_round
                GROUP BY wallet
            ),
            total_prizes AS (
                SELECT 
                    winner,
                    SUM(lastExtra) AS total_prizes
                FROM ${prizeTable} p
                JOIN round_range r ON p.roundId BETWEEN r.start_round AND r.end_round
                GROUP BY winner
            ),
            combined_results AS (
                SELECT 
                    COALESCE(t.wallet, p.winner) AS wallet,
                    COALESCE(t.total_bets, 0) AS total_bets,
                    COALESCE(p.total_prizes, 0) AS total_prizes,
                    COALESCE(p.total_prizes, 0) * 0.01 AS tax,
                    (COALESCE(p.total_prizes, 0) * 0.99) - COALESCE(t.total_bets, 0) AS net
                FROM total_bets t
                LEFT JOIN total_prizes p ON t.wallet = p.winner
                
                UNION
                
                SELECT 
                    p.winner AS wallet,
                    0 AS total_bets,
                    p.total_prizes,
                    p.total_prizes * 0.01 AS tax,
                    (p.total_prizes * 0.99) AS net
                FROM total_prizes p
                LEFT JOIN total_bets t ON p.winner = t.wallet
                WHERE t.wallet IS NULL
            )
            SELECT 
                wallet AS address,
                total_bets,
                total_prizes,
                tax,
                net
            FROM combined_results
            WHERE net ${netCondition}
            ORDER BY net ${orderDirection}
            LIMIT 20;
        `;

        console.log('Executing query:', query);

        const [results] = await pool.query(query);
        console.log(`Query results for ${wheelType} ${resultType}:`, results);
        
        res.json(results);
    } catch (error) {
        console.error(`Error fetching top 20 ${wheelType} ${resultType}s:`, error);
        res.status(500).json({ error: `An error occurred while fetching top 20 ${wheelType} ${resultType}s data`, details: error.message });
    }
}

app.post('/check-wallet-limited-2', async (req, res) => {
    const { wallet } = req.body;
    if (!wallet) {
        return res.status(400).send('Wallet address is required');
    }

    try {
        const [prizeResults] = await pool.query('SELECT SUM(lastExtra) AS total_pool FROM limited_prize WHERE winner = ?', [wallet]);
        const [costResults] = await pool.query('SELECT SUM(bets) AS total_bets FROM limited_cost WHERE wallet = ?', [wallet]);

        const [topWinnings] = await pool.query(
            'SELECT roundId, CAST(lastExtra AS DECIMAL(10,3)) AS winnings FROM limited_prize WHERE winner = ? ORDER BY lastExtra DESC LIMIT 10',
            [wallet]
        );

        res.json({ prizeResults, costResults, topWinnings });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.post('/check-main-round-2', async (req, res) => {
    const { roundId } = req.body;
    if (!roundId) {
        return res.status(400).send('Round ID is required');
    }

    try {
        const [roundResults] = await pool.query(
            'SELECT roundId, randomWord, lastExtra AS pool, remainder AS winningNumber, winner FROM prize_update WHERE roundId = ?',
            [roundId]
        );

        let response = {};

        if (roundResults.length > 0) {
            response.roundInfo = roundResults[0];
        }

        // Call the contract's getRound method
        const roundData = await contract.getRound(roundId);
        response.deposits = roundData.deposits.map((deposit, index, array) => {
            const currentAmount = BigInt(deposit[6]);
            const prevAmount = index > 0 ? BigInt(array[index - 1][6]) : BigInt(0);
            const ethBetAmount = index === 0 
                ? Number(ethers.utils.formatEther(currentAmount)) * 0.01
                : Number(ethers.utils.formatEther(currentAmount - prevAmount)) * 0.01;
            
            const startRange = Number(prevAmount);
            const endRange = Number(currentAmount) - 1;
            const winningNumberRange = startRange === endRange ? `${startRange}` : `${startRange}-${endRange}`;

            return {
                address: deposit[4],
                ethBetAmount: ethBetAmount.toFixed(2),
                winningNumberRange: winningNumberRange
            };
        });

        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.post('/check-limited-round', async (req, res) => {
    const { roundId } = req.body;
    if (!roundId) {
        return res.status(400).send('Round ID is required');
    }

    try {
        const [roundResults] = await pool.query(
            'SELECT roundId, randomWord, lastExtra AS pool, remainder AS winningNumber, winner FROM limited_prize WHERE roundId = ?',
            [roundId]
        );

        let response = {};

        if (roundResults.length > 0) {
            response.roundInfo = roundResults[0];
        }

        // Call the limited contract's getRound method
        const roundData = await limitedContract.getRound(roundId);
        response.deposits = roundData.deposits.map((deposit, index, array) => {
            const currentAmount = BigInt(deposit[6]);
            const prevAmount = index > 0 ? BigInt(array[index - 1][6]) : BigInt(0);
            const ethBetAmount = index === 0 
                ? Number(ethers.utils.formatEther(currentAmount)) * 0.01
                : Number(ethers.utils.formatEther(currentAmount - prevAmount)) * 0.001;
            
            const startRange = Number(prevAmount);
            const endRange = Number(currentAmount) - 1;
            const winningNumberRange = startRange === endRange ? `${startRange}` : `${startRange}-${endRange}`;

            return {
                address: deposit[4],
                ethBetAmount: ethBetAmount.toFixed(4),
                winningNumberRange: winningNumberRange
            };
        });

        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.get('/check-last-main-round-2', async (req, res) => {
    try {
        console.log('Received request for /check-last-main-round');
        const [lastRound] = await pool.query('SELECT roundId FROM prize_update ORDER BY roundId DESC LIMIT 1');
        
        if (lastRound.length > 0) {
            const roundId = lastRound[0].roundId;
            console.log('Last round ID:', roundId);
            
            const [roundResults] = await pool.query(
                'SELECT roundId, randomWord, lastExtra AS pool, remainder AS winningNumber, winner FROM prize_update WHERE roundId = ?',
                [roundId]
            );
            console.log('Round results:', roundResults);

            let response = { roundInfo: roundResults[0] };

            // Call the contract's getRound method
            const roundData = await contract.getRound(roundId);
            console.log('Last round ID:', roundId);
            response.deposits = roundData.deposits.map((deposit, index, array) => {
                const currentAmount = BigInt(deposit[6]);
                const prevAmount = index > 0 ? BigInt(array[index - 1][6]) : BigInt(0);
                const ethBetAmount = index === 0 
                    ? Number(ethers.utils.formatEther(currentAmount)) * 0.01
                    : Number(ethers.utils.formatEther(currentAmount - prevAmount)) * 0.01;
                
                const startRange = Number(prevAmount);
                const endRange = Number(currentAmount) - 1;
                const winningNumberRange = startRange === endRange ? `${startRange}` : `${startRange}-${endRange}`;

                return {
                    address: deposit[4],
                    ethBetAmount: ethBetAmount.toFixed(2),
                    winningNumberRange: winningNumberRange
                };
            });

            res.json(response);
        } else {
            console.log('No rounds found'); 
            res.status(404).send('No rounds found');
        }
    } catch (error) {
        console.error('Error in /check-last-main-round:', error);
        res.status(500).send('Server error');
    }
});

app.get('/check-last-limited-round', async (req, res) => {
    try {
        const [lastRound] = await pool.query('SELECT roundId FROM limited_prize ORDER BY roundId DESC LIMIT 1');
        
        if (lastRound.length > 0) {
            const roundId = lastRound[0].roundId;
            const [roundResults] = await pool.query(
                'SELECT roundId, randomWord, lastExtra AS pool, remainder AS winningNumber, winner FROM limited_prize WHERE roundId = ?',
                [roundId]
            );

            let response = {};

            if (roundResults.length > 0) {
                response.roundInfo = roundResults[0];
            }

            // Call the limited contract's getRound method
            const roundData = await limitedContract.getRound(roundId);
            response.deposits = roundData.deposits.map((deposit, index, array) => {
                const currentAmount = BigInt(deposit[6]);
                const prevAmount = index > 0 ? BigInt(array[index - 1][6]) : BigInt(0);
                const ethBetAmount = index === 0 
                    ? Number(ethers.utils.formatEther(currentAmount)) * 0.01
                    : Number(ethers.utils.formatEther(currentAmount - prevAmount)) * 0.001;
                
                const startRange = Number(prevAmount);
                const endRange = Number(currentAmount) - 1;
                const winningNumberRange = startRange === endRange ? `${startRange}` : `${startRange}-${endRange}`;

                return {
                    address: deposit[4],
                    ethBetAmount: ethBetAmount.toFixed(4),
                    winningNumberRange: winningNumberRange
                };
            });

            res.json(response);
        } else {
            res.status(404).send('No rounds found');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// New: Get the winning numbers of the last 100 rounds
app.get('/last-100-winning-numbers-2', async (req, res) => {
    try {
        const [results] = await pool.query(
            'SELECT roundId, remainder AS winning_number, lastExtra AS pool FROM prize_update ORDER BY roundId DESC LIMIT 100'
        );
        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// New: Get the betting distribution of future rounds
app.post('/future-rounds-deposits-2', async (req, res) => {
    const { startRoundId, numRounds } = req.body;
    if (!startRoundId || !numRounds || numRounds <= 0 || numRounds > 100) {
        return res.status(400).send('Invalid input');
    }

    try {
        let allRounds = [];
        for (let i = 0; i < numRounds; i++) {
            const roundId = BigInt(startRoundId) + BigInt(i);
            const roundData = await contract.getRound(roundId);
            const deposits = roundData.deposits.map((deposit, index, array) => {
                const currentAmount = BigInt(deposit[6]);
                const prevAmount = index > 0 ? BigInt(array[index - 1][6]) : BigInt(0);
                const ethBetAmount = index === 0 
                    ? Number(currentAmount) * 0.01
                    : Number((currentAmount - prevAmount)) * 0.01;
                
                const startRange = Number(prevAmount);
                const endRange = Number(currentAmount) - 1;
                const winningNumberRange = startRange === endRange ? `${startRange}` : `${startRange}-${endRange}`;

                return {
                    address: deposit[4],
                    ethBetAmount: ethBetAmount, // No longer using toFixed(4)
                    winningNumberRange: winningNumberRange
                };
            });
            allRounds.push({
                roundId: roundId.toString(),
                deposits: deposits
            });
        }
        res.json(allRounds);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.post('/check-wallet-single-2', async (req, res) => {
    const { wallet } = req.body;
    if (!wallet) {
        return res.status(400).json({ error: 'Wallet address is required' });
    }

    const modules = ['flipper', 'quantum', 'laserblast'];
    let results = [];

    try {
        for (const module of modules) {
            const eventsTable = `${module}_events`;
            const payTable = `${module}_pay`;

            const eventsQuery = `
                SELECT 
                    player,
                    COUNT(*) as ${module}_tx,
                    ROUND(SUM(eth), 5) as total_E,
                    ROUND(SUM(yolo), 2) as total_Y
                FROM 
                    ${eventsTable}
                WHERE 
                    player = ?
                GROUP BY 
                    player
            `;

            const payQuery = `
                SELECT 
                    ROUND(SUM(eth_payout), 5) as E_payout,
                    ROUND(SUM(yolo_payout), 2) as Y_payout
                FROM 
                    ${payTable}
                WHERE 
                    player = ?
            `;

            const [eventsRows] = await pool.query(eventsQuery, [wallet]);
            const [payRows] = await pool.query(payQuery, [wallet]);

            if (eventsRows.length > 0) {
                const result = {
                    module,
                    ...eventsRows[0],
                    ...payRows[0],
                    E_net: payRows[0] ? (payRows[0].E_payout - eventsRows[0].total_E).toFixed(5) : null,
                    Y_net: payRows[0] ? (payRows[0].Y_payout - eventsRows[0].total_Y).toFixed(2) : null
                };
                results.push(result);
            }
        }

        res.json(results);
    } catch (error) {
        console.error('Database query error:', error);
        res.status(500).json({ error: 'An error occurred while fetching data' });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log('Routes:');
});
