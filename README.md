# Payment Tracker

Level 2 Stellar payment tracker with Freighter wallet connection, Soroban contract calls, transaction status tracking, and frontend state synchronization.

## Features

- Freighter wallet connection for Stellar testnet signing.
- Handles wallet not found, rejected request, and insufficient balance errors.
- Soroban testnet contract for creating and listing payment records.
- Frontend contract write and read paths.
- Contract event polling that refreshes frontend state after new payment events.
- Pending, success, and failed transaction status with Stellar Explorer links.

## Setup

Run the frontend locally:

```powershell
cd Frontend
npm.cmd install
npm.cmd run dev
```

You can also deploy the `Frontend` folder to Netlify/Vercel as a static site.

To build and deploy the contract:

```powershell
cd Backend
cargo test
stellar contract build
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/payment_tracker.wasm --source YOUR_TESTNET_IDENTITY --network testnet
```

After deployment, paste the contract id into `Frontend/src/app.js`:

```js
const CONTRACT_ID = "YOUR_DEPLOYED_TESTNET_CONTRACT_ID";
```

When a wallet is connected, the frontend polls testnet contract events every five seconds and reloads `list_payments` when a new contract event appears.

## Submission Values

- Live demo: optional, add your deployed URL here.
- Deployed contract address: `PASTE_DEPLOYED_TESTNET_CONTRACT_ID_HERE`
- Verifiable contract call transaction hash: `PASTE_SUCCESSFUL_TRANSACTION_HASH_HERE`

## Requirement Status

- Frontend builds successfully with Vite.
- Wallet connection flow is implemented for Freighter.
- Contract source and unit test are included.
- Contract deployment is still required.
- A real deployed contract id must be added to `Frontend/src/app.js`.
- A successful testnet transaction hash is still required for submission.

## Screenshots

Add a screenshot of the wallet options dialog after clicking **Connect wallet**.

## Notes

The app is ready for static hosting, but a real deployed contract id and a successful testnet transaction hash must come from your funded Stellar testnet wallet.
