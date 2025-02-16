const contractAddress = '0x0000000000E14E87e5c80A8A90817308fFF715d3';
const limitedContractAddress = '0x28EF3eaE1AbB6D6e22e9bFc7a0944f707E4726b3';
const abi = [
    "function getRound(uint256 roundId) external view returns (uint8 status, uint40 maximumNumberOfParticipants, uint16 roundProtocolFeeBp, uint40 cutoffTime, uint40 drawnAt, uint40 numberOfParticipants, address winner, uint96 roundValuePerEntry, uint256 protocolFeeOwed, tuple(uint256, uint256, uint256, uint256, address, bool, uint256)[] deposits)"
];

// Global variable for storing the connected wallet address
window.userWalletAddress = null;

// Define Blast network information
const blastNetwork = {
    chainId: '0x13e31', // Please modify according to the actual chain ID
    chainName: 'Blast Network',
    rpcUrls: ['https://rpc.blast.io'], // RPC URL for Blast network
    nativeCurrency: {
        name: 'Blast ETH',
        symbol: 'ETH',
        decimals: 18,
    },
    blockExplorerUrls: ['https://blastscan.io'], // Block explorer URL for Blast network
};

// Subscription address
const subscriptionAddress = '0x6eAAf3aE8B1555861Db9Ba88004384fCEA819A18';

// Global state variables
let isUserLoggedIn = false;
let isWalletConnected = false;
let userName = '';

// Update the "Connect Wallet" button text to show the abbreviated wallet address
function updateWalletAddress(address) {
    const connectWalletBtn = document.getElementById('connectWalletBtn');
    const abbreviatedAddress = address.slice(0, 6) + '...' + address.slice(-4);
    connectWalletBtn.textContent = abbreviatedAddress;
}

async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            // Switch to the Blast network
            await ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [blastNetwork],
            });

            // Request the user to connect their wallet
            const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
            const account = accounts[0];
            updateWalletAddress(account);
            window.userWalletAddress = account;
            isWalletConnected = true;

            // Check if the user is already registered
            const isSignedUp = await checkIfUserSignedUp(account);
            if (isSignedUp) {
                // Retrieve the username
                userName = await getUserNameByWallet(account);
                isUserLoggedIn = true;
                updateUIAfterLogin();
            }
        } catch (error) {
            console.error('User refused to connect wallet or change chain', error);
        }
    } else {
        alert('Please install MetaMask or other EVM compatible wallets');
    }
}

// Helper function to check if the wallet is connected and to verify subscription status
async function walletCheck() {
    if (localStorage.getItem('loggedIn') === 'true') {
        // Check whether the wallet corresponding to the username is still valid
        const username = localStorage.getItem('username');
        const response = await fetch(`/check-user-subscription?username=${username}`);
        const data = await response.json();

        if (data.valid) {
            return true;
        } else {
            alert('Your subscription has expired. Please subscribe first.');
            return false;
        }
    } else {
        if (!isWalletConnected) {
            alert('Please connect your wallet first.');
            return false;
        }

        // Check subscription status
        try {
            const response = await fetch(`/check-subscription?walletAddress=${window.userWalletAddress}`);
            const data = await response.json();

            if (!data.valid) {
                alert('Your subscription has expired. Please subscribe first.');
                return false;
            }
        } catch (error) {
            console.error('Error checking subscription:', error);
            alert('Error checking subscription. Please try again.');
            return false;
        }

        return true;
    }
}

async function checkIfUserSignedUp(walletAddress) {
    try {
        const response = await fetch(`/check-user-by-wallet?walletAddress=${walletAddress}`);
        const data = await response.json();
        return data.isSignedUp;
    } catch (error) {
        console.error('Error checking if user is signed up:', error);
        return false;
    }
}

async function getUserNameByWallet(walletAddress) {
    try {
        const response = await fetch(`/get-username-by-wallet?walletAddress=${walletAddress}`);
        const data = await response.json();
        return data.username || '';
    } catch (error) {
        console.error('Error getting username by wallet:', error);
        return '';
    }
}

// Open and close the subscription modal
function openSubscribeModal() {
    document.getElementById('subscribeModal').style.display = 'block';
}

function closeSubscribeModal() {
    document.getElementById('subscribeModal').style.display = 'none';
}

// Handle subscription payment
async function handleSubscriptionPayment(event) {
    if (!isWalletConnected) {
        alert('Please connect your wallet first.');
        return;
    }

    const amount = event.target.getAttribute('data-amount');
    const duration = event.target.getAttribute('data-duration');
    const weiAmount = ethers.utils.parseEther(amount);

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();

        // Send the transaction
        const tx = await signer.sendTransaction({
            to: subscriptionAddress,
            value: weiAmount,
        });

        // Display the transaction hash and processing status
        const paymentStatus = document.getElementById('paymentStatus');
        paymentStatus.innerHTML = `
            <p>Transaction Hash: <a href="https://explorer.blast.io/tx/${tx.hash}" target="_blank">${tx.hash}</a></p>
            <p>Payment Processing...</p>
        `;

        // Call the backend API to save transaction information
        const response = await fetch('/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                txHash: tx.hash,
                walletAddress: window.userWalletAddress,
                amount: parseFloat(amount),
                duration: parseInt(duration),
            }),
        });

        const data = await response.json();

        if (data.success) {
            paymentStatus.innerHTML += `<p>${amount} ETH received. Subscription activated!</p>`;
        } else {
            paymentStatus.innerHTML += `<p>Error: ${data.message}</p>`;
        }
    } catch (error) {
        console.error('Payment failed', error);
        alert('Sorry, payment failed. No enough ETH in your wallet.');
    }
}

// Open the account information modal
function openAccountModal() {
    if (!isUserLoggedIn) {
        alert('Please log in or connect your wallet first.');
        return;
    }

    const walletAddress = window.userWalletAddress;

    // Call the backend API to get subscription information
    fetch(`/account-info?walletAddress=${walletAddress}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Display subscription information
                const accountContent = document.getElementById('accountContent');
                let html = `<p class="account-expire-date">Expire Date: ${new Date(data.expireDate).toLocaleString()}</p>`;
                html += `<h2 class="account-payment-history">Payment History</h2>`;
                data.transactions.forEach(tx => {
                    html += `
                        <div class="account-transaction">
                            <p>Time: ${new Date(tx.time).toLocaleString()}</p>
                            <p>Amount: ${parseFloat(tx.amount).toFixed(2)} ETH</p>  
                            <p><a href="https://blastscan.io/tx/${tx.tx_hash}" target="_blank">${tx.tx_hash}</a></p>
                        </div>
                    `;
                });

                accountContent.innerHTML = html;
                document.getElementById('accountModal').style.display = 'block';
            } else {
                alert(data.message);
            }
        })
        .catch(error => {
            console.error('Error fetching account info:', error);
        });
}

// Close the account information modal
function closeAccountModal() {
    document.getElementById('accountModal').style.display = 'none';
}

// Ensure that buttons function properly
function ensureButtonFunctionality() {
    const winningNumbersBtn = document.getElementById('winningNumbersBtn');
    if (winningNumbersBtn) {
        // Remove all existing click event listeners
        winningNumbersBtn.removeEventListener('click', getLast100WinningNumbers);
        winningNumbersBtn.onclick = null;

        // Add a new click event listener
        winningNumbersBtn.addEventListener('click', function(event) {
            event.preventDefault();
            console.log('Button clicked'); // For debugging
            getLast100WinningNumbers();
        });

        // Add a touch event listener in case click events do not work on mobile devices
        // winningNumbersBtn.addEventListener('touchstart', function(event) {
        //     event.preventDefault();
        //     console.log('Button touched'); // For debugging
        //     getLast100WinningNumbers();
        // });
    } else {
        console.error('Winning Numbers button not found');
    }
}

// Modified DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    const darkModeBtn = document.getElementById('darkModeBtn');
    const brightModeBtn = document.getElementById('brightModeBtn');
    const body = document.body;

    darkModeBtn.addEventListener('click', function() {
        body.classList.add('dark-mode');
        localStorage.setItem('mode', 'dark');
        if (document.getElementById('output').innerHTML !== '') {
            getDeposits(); // Re-render results
        }
        ensureButtonFunctionality();
    });

    brightModeBtn.addEventListener('click', function() {
        body.classList.remove('dark-mode');
        localStorage.setItem('mode', 'bright');
        if (document.getElementById('output').innerHTML !== '') {
            getDeposits(); // Re-render results
        }
        ensureButtonFunctionality();
    });

    const savedMode = localStorage.getItem('mode');
    if (savedMode === 'dark') {
        body.classList.add('dark-mode');
    }

    ensureButtonFunctionality();

    // Check login status
    const loggedIn = localStorage.getItem('loggedIn') === 'true';
    const username = localStorage.getItem('username');

    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');

    if (loggedIn && username) {
        loginBtn.textContent = username;

        const walletAddress = localStorage.getItem('walletAddress');
        if (walletAddress) {
            updateWalletAddress(walletAddress);
        }

        // Show dropdown menu
        loginBtn.addEventListener('click', function() {
            userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none';
        });

        // Bind logout event
        document.getElementById('logoutBtn').addEventListener('click', function() {
            localStorage.removeItem('loggedIn');
            localStorage.removeItem('username');
            location.reload();
        });
    } else {
        // If not logged in, clicking the button opens the login modal
        loginBtn.addEventListener('click', openLoginModal);
    }
 
    // Check login status and initialize global variables
    isUserLoggedIn = localStorage.getItem('loggedIn') === 'true';
    userName = localStorage.getItem('username') || '';
    window.userWalletAddress = localStorage.getItem('walletAddress') || null;
    isWalletConnected = !!window.userWalletAddress;

    updateUIAfterLogin();

    const mainWheelWinnerBtn = document.getElementById('mainWheelWinnerBtn');
    const mainWheelUnderwaterBtn = document.getElementById('mainWheelUnderwaterBtn');
    const limitedWheelWinnerBtn = document.getElementById('limitedWheelWinnerBtn');
    const limitedWheelUnderwaterBtn = document.getElementById('limitedWheelUnderwaterBtn');

    if (mainWheelWinnerBtn) mainWheelWinnerBtn.addEventListener('click', () => checkTop20('main', 'winner'));
    if (mainWheelUnderwaterBtn) mainWheelUnderwaterBtn.addEventListener('click', () => checkTop20('main', 'underwater'));
    if (limitedWheelWinnerBtn) limitedWheelWinnerBtn.addEventListener('click', () => checkTop20('limited', 'winner'));
    if (limitedWheelUnderwaterBtn) limitedWheelUnderwaterBtn.addEventListener('click', () => checkTop20('limited', 'underwater'));

    document.getElementById('checkMainRoundBtn').addEventListener('click', function() {
        const roundId = document.getElementById('mainRoundInput').value;
        checkMainRound(roundId);
    });

    document.getElementById('checkLastMainRoundBtn').addEventListener('click', checkLastMainRound);

    document.getElementById('checkLimitedRoundBtn').addEventListener('click', function() {
        const roundId = document.getElementById('limitedRoundInput').value;
        checkLimitedRound(roundId);
    });

    document.getElementById('checkLastLimitedRoundBtn').addEventListener('click', checkLastLimitedRound);

    // Smooth scrolling for navigation links
    var navLinks = document.querySelectorAll('nav a');

    navLinks.forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent the default anchor jump behavior

            var targetId = this.getAttribute('href').substring(1);
            var targetElement = document.getElementById(targetId);

            if (targetElement) {
                var targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
                var offsetPosition = targetPosition - 150;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Add event listener for the "Connect Wallet" button
    document.getElementById('connectWalletBtn').addEventListener('click', connectWallet);

    // Add event listener for the "Subscribe" button
    document.getElementById('subscribeBtn').addEventListener('click', openSubscribeModal);
    document.getElementById('closeSubscribeModal').addEventListener('click', closeSubscribeModal);

    // Add event listener for payment buttons
    const payButtons = document.querySelectorAll('.payButton');
    payButtons.forEach(button => {
        button.addEventListener('click', handleSubscriptionPayment);
    });

    // Add event listener for the "Account" button
    document.getElementById('accountBtn').addEventListener('click', openAccountModal);
    document.getElementById('closeAccountModal').addEventListener('click', closeAccountModal);

    // Sign Up button
    document.getElementById('signUpBtn').addEventListener('click', openSignUpModal);
    document.getElementById('closeSignUpModal').addEventListener('click', closeSignUpModal);
    document.getElementById('signUpSubmitBtn').addEventListener('click', handleSignUp);

    // Login button
    document.getElementById('loginBtn').addEventListener('click', openLoginModal);
    document.getElementById('closeLoginModal').addEventListener('click', closeLoginModal);
    document.getElementById('loginSubmitBtn').addEventListener('click', handleLogin);

    // Forgot Password
    document.getElementById('forgotPasswordLink').addEventListener('click', function(event) {
        event.preventDefault();
        closeLoginModal();
        openForgotPasswordModal();
    });
    document.getElementById('closeForgotPasswordModal').addEventListener('click', closeForgotPasswordModal);
    document.getElementById('forgotPasswordSubmitBtn').addEventListener('click', handleForgotPassword);

    // Bind logout button click event
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Bind Notification button event
    const notificationBtn = document.getElementById('notificationBtn');
    notificationBtn.addEventListener('click', openNotificationModal);

    // Bind close modal event
    document.getElementById('closeNotificationModal').addEventListener('click', closeNotificationModal);

    // Bind confirm button event
    document.getElementById('notificationConfirmBtn').addEventListener('click', handleNotificationConfirm);

    // Add event listeners for other buttons (if needed)
    // document.getElementById('checkLimitedWalletBtn').addEventListener('click', checkLimitedWallet);
    // document.getElementById('checkAllBtn').addEventListener('click', queryAllData);
    // document.getElementById('calculateWinningBtn').addEventListener('click', calculateWinningNumber);
    // document.getElementById('recentPnLCheckBtn').addEventListener('click', checkRecentPnL);
});

async function checkWallet() {
    if (!await walletCheck()) return;

    const wallet = document.getElementById('walletInput').value;
    const response = await fetch('/check-wallet-2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ wallet }),
    });
    const data = await response.json();

    const totalPool = parseFloat(data.prizeResults[0].total_pool) || 0;
    const totalBets = parseFloat(data.costResults[0].total_bets) || 0;
    const tax = totalPool * 0.01;
    const net = totalPool * 0.99 - totalBets;

    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = `
        <table>
            <tr>
                <th>Wallet Address</th>
                <th>Winnings</th>
                <th>Bets</th>
                <th>Tax</th>
                <th>Net</th>
            </tr>
            <tr>
                <td>${wallet}</td>
                <td>${totalPool.toFixed(2)}</td>
                <td>${totalBets.toFixed(2)}</td>
                <td>${tax.toFixed(2)}</td>
                <td class="net-value ${net >= 0 ? 'positive' : 'negative'}">${net.toFixed(2)}</td>
            </tr>
        </table>
    `;

    // Display top winnings
    const topWinningsDiv = document.getElementById('topWinnings');
    if (data.topWinnings && data.topWinnings.length > 0) {
        let topWinningsHtml = `
            <h2>Top 10 Winnings</h2>
            <table>
                <tr class="round-info">
                    <th>Round</th>
        `;
        data.topWinnings.forEach(win => {
            topWinningsHtml += `
                <th><a href="https://yologames.io/yolo/blast/${win.roundId}" target="_blank">${win.roundId}</a></th>
            `;
        });
        topWinningsHtml += `
                </tr>
                <tr class="round-info">
                    <th>Winnings</th>
        `;
        data.topWinnings.forEach(win => {
            const winnings = parseFloat(win.winnings);
            topWinningsHtml += `
                <td>${winnings.toFixed(2)}</td>
            `;
        });
        topWinningsHtml += `
                </tr>
            </table>
        `;
        topWinningsDiv.innerHTML = topWinningsHtml;
    } else {
        topWinningsDiv.innerHTML = '<p>No winning rounds found for this wallet.</p>';
    }
}

async function checkLimitedWallet() {
    if (!await walletCheck()) return;

    const wallet = document.getElementById('limitedWalletInput').value;
    const response = await fetch('/check-wallet-limited-2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ wallet }),
    });
    const data = await response.json();

    const totalPool = parseFloat(data.prizeResults[0].total_pool) || 0;
    const totalBets = parseFloat(data.costResults[0].total_bets) || 0;
    const tax = totalPool * 0.01;
    const net = totalPool * 0.99 - totalBets;

    const resultsDiv = document.getElementById('limitedResults');
    resultsDiv.innerHTML = `
        <table>
            <tr>
                <th>Wallet Address</th>
                <th>Winnings</th>
                <th>Bets</th>
                <th>Tax</th>
                <th>Net</th>
            </tr>
            <tr>
                <td>${wallet}</td>
                <td>${totalPool.toFixed(3)}</td>
                <td>${totalBets.toFixed(3)}</td>
                <td>${tax.toFixed(3)}</td>
                <td class="net-value ${net >= 0 ? 'positive' : 'negative'}">${net.toFixed(3)}</td>
            </tr>
        </table>
    `;

    const topWinningsDiv = document.getElementById('limitedTopWinnings');
    if (data.topWinnings && data.topWinnings.length > 0) {
        let topWinningsHtml = `
            <h2>Limited Wheel Top 10 Winnings</h2>
            <table>
                <tr class="round-info">
                    <th>Round</th>
        `;
        data.topWinnings.forEach(win => {
            topWinningsHtml += `
                <th><a href="https://yologames.io/yolo-limited/blast/${win.roundId}" target="_blank">${win.roundId}</a></th>
            `;
        });
        topWinningsHtml += `
                </tr>
                <tr class="round-info">
                    <th>Winnings</th>
        `;
        data.topWinnings.forEach(win => {
            const winnings = parseFloat(win.winnings);
            topWinningsHtml += `
                <td>${winnings.toFixed(3)}</td>
            `;
        });
        topWinningsHtml += `
                </tr>
            </table>
        `;
        topWinningsDiv.innerHTML = topWinningsHtml;
    } else {
        topWinningsDiv.innerHTML = '<p>No winning rounds found for this wallet.</p>';
    }
}

async function queryAllData() {
    if (!await walletCheck()) return;

    const wallet = document.getElementById('singlewalletInput').value.trim();
    const resultsDiv = document.getElementById('single-results');
    const fetchingMessage = document.getElementById('fetchingMessage');

    if (!wallet) {
        resultsDiv.innerHTML = '<p class="text-red-500">Please enter wallet address</p>';
        return;
    }

    fetchingMessage.classList.remove('hidden');

    try {
        const response = await fetch('/check-wallet-single-2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ wallet }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const allData = await response.json();

        if (allData.length === 0) {
            resultsDiv.innerHTML = '<p class="text-yellow-500">No results found</p>';
            return;
        }

        const table = createTable(allData);

        resultsDiv.innerHTML = '';
        resultsDiv.appendChild(table);

    } catch (error) {
        console.error('Error:', error);
        resultsDiv.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
    } finally {
        fetchingMessage.classList.add('hidden');
    }
}

function createTable(allData) {
    const table = document.createElement('table');
    table.className = 'min-w-full table-auto border-collapse border border-gray-300';

    const headers = ['Game', 'Player', 'Transactions', 'Total ETH', 'ETH Payout', 'ETH Net', 'Total YOLO', 'YOLO Payout', 'YOLO Net'];
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.className = 'table-cell table-header text-left text-sm uppercase tracking-wider p-2 border border-gray-300 bg-gray-100';
        th.textContent = header;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    allData.forEach((data, index) => {
        const dataRow = document.createElement('tr');
        dataRow.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';

        const rowData = [
            data.module,
            data.player,
            data[`${data.module}_tx`],
            data.total_E,
            data.E_payout,
            data.E_net,
            data.total_Y,
            data.Y_payout,
            data.Y_net
        ];

        rowData.forEach((value, cellIndex) => {
            const td = document.createElement('td');
            td.className = 'table-cell whitespace-nowrap p-2 border border-gray-300';

            if (cellIndex === 0) {
                td.textContent = value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
            } else if (cellIndex === 2) {
                td.textContent = value ? Math.round(value) : '0';
            } else if (typeof value === 'number') {
                td.textContent = value.toFixed(cellIndex >= 6 ? 2 : 5);
            } else {
                td.textContent = value || '0';
            }

            if (cellIndex === 5 || cellIndex === 8) {
                td.classList.add('font-bold');
                const numValue = parseFloat(value) || 0;
                if (numValue > 0) {
                    td.classList.add('positive');
                    td.style.color = 'green';
                } else if (numValue < 0) {
                    td.classList.add('negative');
                    td.style.color = 'red';
                }
            }

            dataRow.appendChild(td);
        });
        table.appendChild(dataRow);
    });

    return table;
}

async function checkMainRound(roundId) {
    if (!await walletCheck()) return;

    try {
        const response = await fetch('/check-main-round-2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roundId }),
        });
        const data = await response.json();
        displayRoundResult(data, 'main');
    } catch (error) {
        console.error('Error checking main round:', error);
    }
}

async function checkLastMainRound() {
    if (!await walletCheck()) return;

    try {
        const response = await fetch('/check-last-main-round-2');
        const data = await response.json();
        document.getElementById('mainRoundInput').value = data.roundInfo.roundId;
        displayRoundResult(data, 'main');
    } catch (error) {
        console.error('Error checking last main round:', error);
    }
}

async function checkLimitedRound(roundId) {
    if (!await walletCheck()) return;

    try {
        const response = await fetch('/check-limited-round', {
            method: 'POST',
            headers: {'Content-Type': 'application/json',},
            body: JSON.stringify({ roundId }),
        });
        const data = await response.json();
        displayRoundResult(data, 'limited');
    } catch (error) {
        console.error('Error checking limited round:', error);
    }
}

async function checkLastLimitedRound() {
    if (!await walletCheck()) return;

    try {
        const response = await fetch('/check-last-limited-round');
        const data = await response.json();
        document.getElementById('limitedRoundInput').value = data.roundInfo.roundId;
        displayRoundResult(data, 'limited');
    } catch (error) {
        console.error('Error checking last limited round:', error);
    }
}

function displayRoundResult(data, type) {
    const roundResultDiv = document.getElementById(`${type}RoundResult`);
    const depositsResultDiv = document.getElementById(`${type}DepositsResult`);

    if (data.roundInfo) {
        let html = `
            <table>
                <tr>
                    <th>Round ID</th>
                    <th>Random Word</th>
                    <th>Total Bets</th>
                    <th>Winning Number</th>
                    <th>Winner</th>
                </tr>
                <tr class="round-info">
                    <td>${data.roundInfo.roundId}</td>
                    <td>${data.roundInfo.randomWord}</td>
                    <td>${data.roundInfo.pool}</td>
                    <td>${data.roundInfo.winningNumber}</td>
                    <td>${data.roundInfo.winner}</td>
                </tr>
            </table>
        `;
        roundResultDiv.innerHTML = html;
    } else {
        roundResultDiv.innerHTML = '<p>No round information available.</p>';
    }

    if (data.deposits && Array.isArray(data.deposits) && data.deposits.length > 0) {
        let depositsHtml = `
            <h5 class="subsection-title">Deposits Distribution of Round ${data.roundInfo.roundId}</h5>
            <table>
                <tr>
                    <th>Wallet Address</th>
                    <th>Bets</th>
                    <th>Win Range</th>
                </tr>
        `;

        const multiplier = type === 'limited' ? 0.001 : 0.01;
        const decimalPlaces = type === 'limited' ? 3 : 2;

        data.deposits.forEach((deposit, index, array) => {
            try {
                const rangeNumbers = deposit.winningNumberRange.split('-').map(Number);
                const startRange = rangeNumbers[0];
                const endRange = rangeNumbers.length > 1 ? rangeNumbers[1] : startRange;
                const ethBetAmount = (endRange - startRange + 1) * multiplier;

                const isWinner = deposit.address.toLowerCase() === data.roundInfo.winner.toLowerCase();
                const rowStyle = isWinner ? 'style="color: red; font-weight: bold;"' : '';

                depositsHtml += `
                    <tr ${rowStyle}>
                        <td>${deposit.address}</td>
                        <td>${ethBetAmount.toFixed(decimalPlaces)}</td>
                        <td>${deposit.winningNumberRange}</td>
                    </tr>
                `;
            } catch (error) {
                console.error('Error processing deposit:', error);
                depositsHtml += `
                    <tr>
                        <td colspan="3">Error processing deposit data</td>
                    </tr>
                `;
            }
        });

        depositsHtml += `</table>`;
        depositsResultDiv.innerHTML = depositsHtml;
    } else {
        depositsResultDiv.innerHTML = '<p>No deposits data available.</p>';
    }
}

function calculateWinningNumber() {
    if (!isWalletConnected) {
        alert('Please connect your wallet first.');
        return;
    }

    const randomWord = BigInt(document.getElementById('randomWordInput').value);
    const pool = BigInt(document.getElementById('poolInput').value);
    const winningNumber = randomWord % pool;

    const calculateResultDiv = document.getElementById('calculateResult');
    calculateResultDiv.innerHTML = `<h2>Winning Number: ${winningNumber.toString()}</h2>`;
}

async function getLast100WinningNumbers() {
    if (!await walletCheck()) return;

    const response = await fetch('/last-100-winning-numbers-2');
    const data = await response.json();

    // Reverse the array so the first number is from the 100th last round
    data.reverse();

    let html = '<div class="winning-numbers-container">';
    for (let i = 0; i < data.length; i += 20) {
        html += '<div class="winning-numbers-row">';
        for (let j = i; j < Math.min(i + 20, data.length); j++) {
            const round = data[j];
            html += `
                <div class="winning-number-cell">
                    <div class="round-id" onclick="window.open('https://yologames.io/yolo/blast/${round.roundId}', '_blank')">${round.roundId}</div>
                    <div class="winning-number">${round.winning_number}</div>
                    <div class="pool">${round.pool}</div>
                </div>
            `;
        }
        html += '</div>';
    }
    html += '</div>';

    document.getElementById('winningNumbersResult').innerHTML = html;

    // Calculate and display hot numbers
    const numberCounts = {};
    data.forEach(round => {
        numberCounts[round.winning_number] = (numberCounts[round.winning_number] || 0) + 1;
    });

    const hotNumbers = Object.entries(numberCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(entry => entry[0]);

    document.getElementById('hotNumbers').innerHTML = '<strong>Hot 5 numbers:</strong>  ' + hotNumbers.join(', ') + '   (blue number is pool size) ';
}

function getRandomColor() {
    const red = Math.floor(Math.random() * 76) + 180;
    const green = Math.floor(Math.random() * 76) + 180;
    const blue = Math.floor(Math.random() * 76) + 180;
    return `rgb(${red}, ${green}, ${blue})`;
}

async function getDeposits() {
    if (!await walletCheck()) return;

    const roundIdInput = document.getElementById('roundIdInput');
    const numRoundsInput = document.getElementById('numRoundsInput');
    const outputDiv = document.getElementById('output');
    const startRoundId = parseInt(roundIdInput.value, 10);
    const numRounds = parseInt(numRoundsInput.value, 10);

    // Clear previous results
    outputDiv.innerHTML = '';

    if (isNaN(startRoundId) || startRoundId <= 0) {
        outputDiv.innerHTML = 'please provide start round';
        return;
    }

    if (isNaN(numRounds) || numRounds <= 0) {
        outputDiv.innerHTML = 'please provide number of rounds';
        return;
    }

    try {
        const response = await fetch('/future-rounds-deposits-2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ startRoundId, numRounds }),
        });
        const allRounds = await response.json();

        let html = '<div class="rounds-container">';

        allRounds.forEach((round, index) => {
            const backgroundColor = getDarkerColor();
            html += `
                <div class="round-container" style="background-color: ${backgroundColor};">
                    <p class="round-title">Round ${round.roundId}</p>
                    <table>
                        <tr><th>Address</th><th>Bets</th><th>Range</th></tr>
                        ${round.deposits.map(deposit => `
                            <tr>
                                <td>${deposit.address}</td>
                                <td>${(deposit.ethBetAmount).toFixed(2)}</td>
                                <td>${deposit.winningNumberRange}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            `;

            // After every three rounds, add a new row
            if ((index + 1) % 3 === 0) {
                html += '</div><div class="rounds-container">';
            }
        });

        html += '</div>';
        outputDiv.innerHTML = html;
    } catch (error) {
        console.error('error:', error);
        outputDiv.innerHTML = 'Error occurred while fetching data. Please make sure you entered the correct round ID';
    }
}

function getDarkerColor() {
    const hue = Math.floor(Math.random() * 360);
    const lightness = document.body.classList.contains('dark-mode') ? '40%' : '30%';
    return `hsl(${hue}, 70%, ${lightness})`;
}

async function checkRecentPnL() {
    if (!await walletCheck()) return;

    const wallet = document.getElementById('recentPnLWalletInput').value;
    const rounds = document.getElementById('recentPnLRoundsInput').value;

    if (!wallet || !rounds || rounds < 1) {
        alert('Please enter a valid wallet address and a positive integer for the number of rounds.');
        return;
    }

    const response = await fetch('/check-recent-pnl', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ wallet, rounds }),
    });
    const data = await response.json();

    const totalPool = parseFloat(data.prizeResults[0].total_pool) || 0;
    const totalBets = parseFloat(data.costResults[0].total_bets) || 0;
    const tax = totalPool * 0.01;
    const net = totalPool * 0.99 - totalBets;

    const resultsDiv = document.getElementById('recentPnLResults');
    resultsDiv.innerHTML = `
        <table>
            <tr>
                <th>Wallet Address</th>
                <th>Winnings</th>
                <th>Bets</th>
                <th>Tax</th>
                <th>Net</th>
            </tr>
            <tr>
                <td>${wallet}</td>
                <td>${totalPool.toFixed(2)}</td>
                <td>${totalBets.toFixed(2)}</td>
                <td>${tax.toFixed(2)}</td>
                <td class="net-value ${net >= 0 ? 'positive' : 'negative'}">${net.toFixed(2)}</td>
            </tr>
        </table>
    `;
}

async function checkTop20(wheelType, resultType) {
    if (!await walletCheck()) return;

    try {
        const response = await fetch(`/top-20-${wheelType}-${resultType}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const data = await response.json();

        const resultsDiv = document.getElementById('top20Results');
        if (data.length > 0) {
            let html = `
                <h5>Top 20 ${wheelType.charAt(0).toUpperCase() + wheelType.slice(1)} Wheel ${resultType.charAt(0).toUpperCase() + resultType.slice(1)}s today</h5>
                <table>
                    <tr>
                        <th>Address</th>
                        <th>Total Bets</th>
                        <th>Total Prizes</th>
                        <th>Tax</th>
                        <th>Net</th>
                    </tr>
            `;
            data.forEach(winner => {
                html += `
                    <tr>
                        <td>${winner.address}</td>
                        <td>${parseFloat(winner.total_bets).toFixed(2)}</td>
                        <td>${parseFloat(winner.total_prizes).toFixed(2)}</td>
                        <td>${parseFloat(winner.tax).toFixed(2)}</td>
                        <td class="${parseFloat(winner.net) < 0 ? 'negative' : 'positive'}">${parseFloat(winner.net).toFixed(2)}</td>
                    </tr>
                `;
            });
            html += '</table>';
            resultsDiv.innerHTML = html;
        } else {
            resultsDiv.innerHTML = '<p>No data available.</p>';
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('top20Results').innerHTML = '<p>Error fetching data.</p>';
    }
}

// Open and close the Sign Up modal
function openSignUpModal() {
    if (!isWalletConnected) {
        alert('Please connect your wallet first.');
        return;
    }
    checkSubscription().then(isSubscribed => {
        if (isSubscribed) {
            document.getElementById('signUpModal').style.display = 'block';
        } else {
            alert('Please subscribe with your wallet first.');
        }
    });
}

function closeSignUpModal() {
    document.getElementById('signUpModal').style.display = 'none';
}

// Open and close the Login modal
function openLoginModal() {
    document.getElementById('loginModal').style.display = 'block';
}

function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
}

// Open and close the Forgot Password modal
function openForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').style.display = 'block';
}

function closeForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').style.display = 'none';
}

async function checkSubscription() {
    if (!isWalletConnected) {
        alert('Please connect your wallet first.');
        return false;
    }

    try {
        const response = await fetch(`/check-subscription?walletAddress=${window.userWalletAddress}`);
        const data = await response.json();

        if (data.valid) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('Error checking subscription:', error);
        return false;
    }
}

async function handleSignUp() {
    const username = document.getElementById('signUpUsername').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    const confirmPassword = document.getElementById('signUpConfirmPassword').value;

    if (!username || !email || !password || !confirmPassword) {
        alert('Please fill in all fields.');
        return;
    }

    if (password !== confirmPassword) {
        alert('Passwords do not match. Please try again.');
        return;
    }

    const walletAddress = window.userWalletAddress;

    const response = await fetch('/sign-up', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, email, password, walletAddress })
    });

    const data = await response.json();

    if (data.success) {
        alert('Sign Up successful!');
        closeSignUpModal();
    
        // Update state
        isUserLoggedIn = true;
        userName = username;
        isWalletConnected = true;
    
        // Update UI
        updateUIAfterLogin();
    } else {
        alert(`Sign Up failed: ${data.message}`);
    }
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('Please enter username and password.');
        return;
    }

    const response = await fetch('/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
        alert('Login successful!');
        closeLoginModal();

        // Update state variables
        isUserLoggedIn = true;
        userName = username;
        window.userWalletAddress = data.walletAddress;
        isWalletConnected = true;

        // Update buttons and UI
        updateUIAfterLogin();
    } else {
        alert(`Login failed: ${data.message}`);
    }
}

function handleLogout() {
    // Clear login state
    isUserLoggedIn = false;
    userName = '';
    isWalletConnected = false;
    window.userWalletAddress = null;

    // Remove login info from local storage (if any)
    localStorage.removeItem('loggedIn');
    localStorage.removeItem('username');
    localStorage.removeItem('walletAddress');

    // Update UI
    updateUIAfterLogin();

    // Disconnect wallet
    disconnectWallet();
}

function disconnectWallet() {
    // Due to browser limitations, it's not possible to fully disconnect the wallet.
    // You may prompt the user to disconnect manually, or simply update the UI.
    // Clear the wallet address display
    const connectWalletBtn = document.getElementById('connectWalletBtn');
    connectWalletBtn.textContent = 'Connect Wallet';
}

function updateUIAfterLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const accountBtn = document.getElementById('accountBtn');
    const signUpBtn = document.getElementById('signUpBtn');
    const notificationBtn = document.getElementById('notificationBtn');
    const connectWalletBtn = document.getElementById('connectWalletBtn');

    if (isUserLoggedIn) {
        // Hide login and sign-up buttons, show logout and notification buttons
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        signUpBtn.style.display = 'none';
        notificationBtn.style.display = 'inline-block';

        // Update account button to display the username
        accountBtn.textContent = userName;

        // Update wallet address display
        if (window.userWalletAddress) {
            updateWalletAddress(window.userWalletAddress);
        }

        // If the wallet is not marked as connected, update the state
        if (!isWalletConnected && window.userWalletAddress) {
            isWalletConnected = true;
        }
    } else {
        // Show login and sign-up buttons, hide logout and notification buttons
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        signUpBtn.style.display = 'inline-block';
        notificationBtn.style.display = 'none';

        // Reset account button text
        accountBtn.textContent = 'Account';

        // Reset wallet button text
        connectWalletBtn.textContent = 'Connect Wallet';
    }
}

function openNotificationModal() {
    document.getElementById('notificationModal').style.display = 'block';

    // Retrieve the user's current threshold setting and display it in the input field
    fetch(`/get-notification-threshold?username=${userName}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('thresholdInput').value = data.threshold || '';
            } else {
                console.error(data.message);
            }
        })
        .catch(error => {
            console.error('Error fetching threshold:', error);
        });
}

function closeNotificationModal() {
    document.getElementById('notificationModal').style.display = 'none';
    document.getElementById('notificationMessage').textContent = '';
}

function handleNotificationConfirm() {
    const thresholdValue = parseFloat(document.getElementById('thresholdInput').value);

    if (isNaN(thresholdValue) || thresholdValue < 0) {
        alert('Please enter a valid number (at least 0.01).');
        return;
    }

    // Send the threshold value to the backend to save
    fetch('/set-notification-threshold', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: userName, threshold: thresholdValue })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            document.getElementById('notificationMessage').textContent = `Updated. You will receive an email notification when the pot of the last spin is ${thresholdValue} ETH or above.`;
        } else {
            alert(`Error: ${data.message}`);
        }
    })
    .catch(error => {
        console.error('Error setting threshold:', error);
    });
}

async function handleForgotPassword() {
    const email = document.getElementById('forgotPasswordEmail').value.trim();

    if (!email) {
        alert('Please enter your email address.');
        return;
    }

    const response = await fetch('/forgot-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (data.success) {
        alert('An email has been sent to your address.');
        closeForgotPasswordModal();
    } else {
        alert(`Error: ${data.message}`);
    }
}

document.getElementById('getDepositsBtn').addEventListener('click', getDeposits);
document.getElementById('winningNumbersBtn').addEventListener('click', getLast100WinningNumbers);
