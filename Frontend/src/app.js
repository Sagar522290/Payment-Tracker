import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from "https://esm.sh/@creit.tech/stellar-wallets-kit@1.7.6";
import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  Address,
  nativeToScVal,
  scValToNative,
} from "https://esm.sh/@stellar/stellar-sdk@13.1.0";

const CONTRACT_ID = "PASTE_DEPLOYED_TESTNET_CONTRACT_ID_HERE";
const RPC_URL = "https://soroban-testnet.stellar.org";
const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: "freighter",
  modules: allowAllModules(),
});

const server = new SorobanRpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

const state = {
  publicKey: "",
  payments: [],
};

const els = {
  connectWallet: document.querySelector("#connectWallet"),
  walletDialog: document.querySelector("#walletDialog"),
  walletOptions: document.querySelector("#walletOptions"),
  walletStatus: document.querySelector("#walletStatus"),
  contractStatus: document.querySelector("#contractStatus"),
  txStatus: document.querySelector("#txStatus"),
  paymentForm: document.querySelector("#paymentForm"),
  recipient: document.querySelector("#recipient"),
  amount: document.querySelector("#amount"),
  memo: document.querySelector("#memo"),
  formMessage: document.querySelector("#formMessage"),
  payments: document.querySelector("#payments"),
};

function shortKey(key) {
  return key ? `${key.slice(0, 6)}...${key.slice(-6)}` : "";
}

function setMessage(message, isError = false) {
  els.formMessage.textContent = message;
  els.formMessage.style.color = isError ? "#a13030" : "#176b55";
}

function setTxStatus(status, hash = "") {
  els.txStatus.innerHTML = hash
    ? `${status} <a href="${EXPLORER_URL}/${hash}" target="_blank" rel="noreferrer">${shortKey(hash)}</a>`
    : status;
}

function addressToScVal(publicKey) {
  return new Address(publicKey).toScVal();
}

function handleWalletError(error) {
  const message = String(error?.message || error || "");

  if (/not found|not installed|extension/i.test(message)) {
    setMessage("Wallet not found. Install Freighter, xBull, or another Stellar wallet.", true);
    return;
  }

  if (/reject|denied|cancel/i.test(message)) {
    setMessage("Request rejected in the wallet.", true);
    return;
  }

  if (/insufficient|balance|fee/i.test(message)) {
    setMessage("Insufficient testnet balance for fees or the requested amount.", true);
    return;
  }

  setMessage(message || "Wallet action failed.", true);
}

async function renderWalletOptions() {
  const wallets = await kit.getSupportedWallets();
  els.walletOptions.replaceChildren();

  wallets.forEach((wallet) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = wallet.name;
    button.addEventListener("click", async () => {
      try {
        await kit.setWallet(wallet.id);
        const { address } = await kit.getAddress();
        state.publicKey = address;
        els.walletStatus.textContent = shortKey(address);
        els.connectWallet.textContent = "Change wallet";
        els.walletDialog.close();
        setMessage("Wallet connected.");
        await loadPayments();
      } catch (error) {
        handleWalletError(error);
      }
    });
    els.walletOptions.append(button);
  });
}

function renderPayments() {
  if (!state.payments.length) {
    els.payments.innerHTML = "<p>No payments loaded yet.</p>";
    return;
  }

  els.payments.innerHTML = state.payments
    .map(
      (payment) => `
        <article class="payment">
          <header>
            <strong>${payment.memo}</strong>
            <span class="badge">${payment.status}</span>
          </header>
          <p>To <span class="mono">${payment.to}</span></p>
          <p>${payment.amount} stroops</p>
        </article>
      `,
    )
    .join("");
}

async function callContract(method, args = []) {
  if (CONTRACT_ID.includes("PASTE_")) {
    throw new Error("Add the deployed contract id in Frontend/src/app.js first.");
  }

  if (!state.publicKey) {
    throw new Error("Connect a wallet first.");
  }

  const account = await server.getAccount(state.publicKey);
  let tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  tx = await server.prepareTransaction(tx);
  const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
    networkPassphrase: Networks.TESTNET,
  });

  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  const result = await server.sendTransaction(signedTx);
  return waitForTransaction(result.hash);
}

async function waitForTransaction(hash) {
  setTxStatus("Pending", hash);

  for (let i = 0; i < 20; i += 1) {
    const response = await server.getTransaction(hash);
    if (response.status === "SUCCESS") {
      setTxStatus("Success", hash);
      return response;
    }
    if (response.status === "FAILED") {
      setTxStatus("Failed", hash);
      throw new Error("Contract transaction failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Transaction is still pending. Check Stellar Explorer.");
}

async function loadPayments() {
  if (CONTRACT_ID.includes("PASTE_") || !state.publicKey) {
    renderPayments();
    return;
  }

  const account = await server.getAccount(state.publicKey);
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("list_payments", addressToScVal(state.publicKey)))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  const value = simulated.result?.retval ? scValToNative(simulated.result.retval) : [];
  state.payments = value.map((item) => ({
    to: item.to,
    amount: item.amount,
    memo: item.memo,
    status: item.status,
  }));
  renderPayments();
}

els.connectWallet.addEventListener("click", async () => {
  await renderWalletOptions();
  els.walletDialog.showModal();
});

els.paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.paymentForm.querySelector("button").disabled = true;
  setMessage("");

  try {
    const response = await callContract("create_payment", [
      addressToScVal(state.publicKey),
      addressToScVal(els.recipient.value),
      nativeToScVal(BigInt(els.amount.value), { type: "i128" }),
      nativeToScVal(els.memo.value),
    ]);

    state.payments.unshift({
      to: els.recipient.value,
      amount: els.amount.value,
      memo: els.memo.value,
      status: "created",
    });
    renderPayments();
    setMessage(`Payment tracked. Hash: ${response.hash}`);
  } catch (error) {
    handleWalletError(error);
  } finally {
    els.paymentForm.querySelector("button").disabled = false;
  }
});

els.contractStatus.textContent = CONTRACT_ID.includes("PASTE_") ? "Not deployed" : shortKey(CONTRACT_ID);
renderPayments();
