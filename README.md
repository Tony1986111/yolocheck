# YOLO Check

YOLO Check is an advanced data analysis tool designed to track, query, and aggregate on-chain data for blockchain-based gambling games (such as those on yologames.io). The project aims to help users conveniently check their wins and losses by providing real-time data from blockchain rounds, account management, and notification features.

## Features

- **On-Chain Data Query**
  Connects to the Blast Network via RPC to fetch the latest round data for gambling games. It calculates winnings, bets, fees, and net results by aggregating various on-chain data from each round (see `yolocheck_server.js`).
- **User Account and Subscription Management**
  Supports user registration, login, password resets, and subscription status checks based on wallet addresses. Only subscribed users can access certain data (see `yolocheck_server.js`).
- **Wallet Connection and Payment**
  Integrates with MetaMask to allow users to connect their wallets. Users can authenticate and pay subscription fees with ETH, triggering blockchain transactions and smart contract interactions (see `yolocheck.js`).
- **Frontend Display and Interaction**
  Uses HTML, CSS, and JavaScript to build a responsive website that displays various data panels, supports dark mode switching, smooth scrolling, and modal dialogs.

  - HTML: `yolocheck.html`
  - CSS: `yolocheck.css`
  - Frontend Logic: `yolocheck.js`
- **Notifications and Email Service**
  Uses nodemailer to send email notifications to users when preset thresholds are met. (Remember to move sensitive credentials like email passwords to environment variables.)

## Project Structure

- **server/**

  - `yolocheck_server.js`: The main backend file built with Express. It handles API requests for user authentication, subscription management, password resets, scheduled tasks, and more.
  - Additional database connection/configuration files (e.g., `db.js`) should be created and configured accordingly.
- **public/**

  - `yolocheck.html`: The main frontend HTML page, defining the website structure and various functional modules.
  - `yolocheck.css`: The stylesheet containing layout, color schemes (including dark mode), and other styles.
  - `yolocheck.js`: Contains the frontend logic for wallet connection, data querying, interactive modals, and other user interactions.
- **Additional Scripts**

  - **update_3_single_games.js**:This script listens for game events from multiple blockchain game contracts, namely **Flipper**, **LaserBlast**, and **Quantum**. It captures events such as game creation and completion, extracts relevant on-chain data (like block number, player, rounds played, and play amounts), and saves the information into designated MySQL tables (e.g., `flipper_events`, `laserblast_events`, and `quantum_events`). It is used to track individual game events and update the database with detailed transaction information.
  - **update_yolo.js**:This script monitors events (specifically the `RandomnessRequested` event) from the Yolo game smart contract. Upon receiving an event, it retrieves the associated round data, calculates key values such as the remainder (used for determining the winning number) and identifies the winning deposit based on specified logic. The processed data is then inserted into the `prize_update` and `cost_update` tables, ensuring that on-chain game outcomes are accurately reflected in the database.
  - **update_yolo_limited.js**:
    Similar in function to `update_yolo.js`, this script is tailored for the Yolo Limited game. It listens for the `RandomnessRequested` events from the corresponding smart contract, processes round data by handling missing, lost, or canceled rounds, and calculates the necessary parameters (such as random words, remainder, and winner determination). The results are stored in the `limited_prize` and `limited_cost` tables, enabling the system to maintain an up-to-date record of the limited game's events.

## Installation and Usage

### Prerequisites

- [Node.js](https://nodejs.org/) and npm
- A MySQL database (or another database of your choice)
- MetaMask or another EVM-compatible wallet

### Installation Steps

* **Clone the repository:**

  ```bash
  git clone https://github.com/yourusername/your-repository.git
  cd your-repository
  ```
* **Install dependencies:**

  ```bash
  npm install
  ```
* **Configure Environment Variables:**
  Create a `.env` file in the project root (ensure this file is listed in `.gitignore` to avoid committing sensitive data). Example content:

  ```dotenv
  EMAIL_USER=your_email@example.com
  EMAIL_PASS=your_email_password_or_app_specific_password
  DB_HOST=your_database_host
  DB_USER=your_database_username
  DB_PASS=your_database_password
  DB_DATABASE=your_database_name
  RPC_PROVIDER=https://your_rpc_provider_url
  ```

  Use a package like [dotenv](https://www.npmjs.com/package/dotenv) to load these variables in your file.
* **Initialize the Database:**
  Create the required tables for users, subscriptions, transactions, and game event logs. Refer to your project documentation or design your own SQL schema as needed.
* **Start the Server:**

  ```bash
  node yolocheck_server.js
  ```

  The server will run on port 3000 by default. You can view the website at `http://localhost:3000`.

## Usage Instructions

* **User Registration & Login:**
  Use the frontend to register and log in. The whole website is hosted and can be found at https://yolocheck.xyz/. Registration verifies that the wallet address and subscription status are valid.
* **Wallet Connection:**
  Click the “Connect Wallet” button to connect via MetaMask. The system will check whether the user is already registered and subscribed.
* **Data Querying:**
  Input your wallet address or round ID in the respective sections to retrieve on-chain data, including win/loss details and historical round data.
* **Subscription Payment:**
  Click “Subscribe” and choose a plan. After paying in ETH, the system updates your subscription status.

## Important Notes

* **Sensitive Data:**
  Always store sensitive information (e.g., email passwords, database credentials) in the `.env` file. Never hardcode such data in your source code.
* **Customization:**
  Feel free to extend and modify the project as needed. The current code is provided as a starting point for further enhancements.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
