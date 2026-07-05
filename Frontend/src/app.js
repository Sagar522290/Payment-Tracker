const {
  Contract,
  Networks,
  rpc,
  TransactionBuilder,
  Address,
  nativeToScVal,
  scValToNative,
} = window.StellarSdk;

const CONTRACT_ID = "PASTE_DEPLOYED_TESTNET_CONTRACT_ID_HERE";
const RPC_URL = "https://soroban-testnet.stellar.org";
const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";
const hasContract = !CONTRACT_ID.includes("PASTE_");

const server = new rpc.Server(RPC_URL);
const contract = hasContract ? new Contract(CONTRACT_ID) : null;

const state = {
  publicKey: "",
  payments: [],
  lastEventLedger: 0,
  eventTimer: null,
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
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

function getFreighterApi() {
  return window.freighterApi || window.freighter || null;
}

async function getFreighterAddress() {
  const freighter = getFreighterApi();

  if (!freighter) {
    throw new Error("Freighter extension not found.");
  }

  if (typeof freighter.requestAccess === "function") {
    const response = await freighter.requestAccess();
    return response.address || response.publicKey || response;
  }

  if (typeof freighter.getAddress === "function") {
    const response = await freighter.getAddress();
    if (response.error) {
      throw response.error;
    }
    return response.address || response.publicKey || response;
  }

  throw new Error("Freighter extension API is not available.");
}

async function signWithFreighter(xdr) {
  const freighter = getFreighterApi();

  if (!freighter || typeof freighter.signTransaction !== "function") {
    throw new Error("Freighter cannot sign transactions.");
  }

  const response = await freighter.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
    address: state.publicKey,
  });

  if (response.error) {
    throw response.error;
  }

  return response.signedTxXdr || response;
}

async function renderWalletOptions() {
  els.walletOptions.replaceChildren();

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Freighter";
  button.addEventListener("click", async () => {
    try {
      const address = await getFreighterAddress();

      if (!address) {
        throw new Error("Wallet did not return an address.");
      }

      state.publicKey = address;
      els.walletStatus.textContent = shortKey(address);
      els.connectWallet.textContent = "Change wallet";
      els.walletDialog.close();
      setMessage("Wallet connected.");
      await loadPayments();
      await startEventSync();
    } catch (error) {
      handleWalletError(error);
    }
  });
  els.walletOptions.append(button);
}

function renderPayments() {
  if (!state.payments.length) {
    els.payments.innerHTML = '<p class="empty-state">No payments loaded yet.</p>';
    return;
  }

  els.payments.innerHTML = state.payments
    .map((payment) => {
      const memo = escapeHtml(payment.memo);
      const to = escapeHtml(payment.to);
      const amount = escapeHtml(payment.amount);
      const status = escapeHtml(payment.status);

      return `
        <article class="payment">
          <header>
            <strong>${memo}</strong>
            <span class="badge">${status}</span>
          </header>
          <p>To <span class="mono">${to}</span></p>
          <p>${amount} stroops</p>
        </article>
      `;
    })
    .join("");
}

async function callContract(method, args = []) {
  if (!hasContract) {
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
  const signedTxXdr = await signWithFreighter(tx.toXDR());

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

async function primeEventCursor() {
  if (!hasContract) {
    return;
  }

  const ledger = await server.getLatestLedger();
  state.lastEventLedger = ledger.sequence;
}

async function syncFromContractEvents() {
  if (!hasContract || !state.publicKey || !state.lastEventLedger) {
    return;
  }

  const response = await server.getEvents({
    startLedger: state.lastEventLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
      },
    ],
    pagination: {
      limit: "10",
    },
  });

  const events = response.events || [];
  if (!events.length) {
    return;
  }

  state.lastEventLedger = Math.max(...events.map((event) => Number(event.ledger || 0))) + 1;
  await loadPayments();
  setMessage("Payment list synchronized from contract events.");
}

async function startEventSync() {
  if (state.eventTimer) {
    clearInterval(state.eventTimer);
  }

  try {
    await primeEventCursor();
    state.eventTimer = setInterval(() => {
      syncFromContractEvents().catch((error) => console.warn("Event sync failed", error));
    }, 5000);
  } catch (error) {
    console.warn("Could not start event sync", error);
  }
}

async function loadPayments() {
  if (!hasContract || !state.publicKey) {
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
  els.walletDialog.showModal();
  try {
    await renderWalletOptions();
  } catch (error) {
    els.walletOptions.replaceChildren();
    handleWalletError(error);
  }
});

els.paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.paymentForm.querySelector("button").disabled = true;
  setMessage("");

  try {
    if (!hasContract) {
      throw new Error("Deploy the contract and add its id before creating payments.");
    }

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
    await syncFromContractEvents();
  } catch (error) {
    handleWalletError(error);
  } finally {
    els.paymentForm.querySelector("button").disabled = false;
  }
});

els.contractStatus.textContent = hasContract ? shortKey(CONTRACT_ID) : "Not deployed";
renderPayments();
