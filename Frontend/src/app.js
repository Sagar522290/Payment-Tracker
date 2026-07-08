import {
  Contract,
  Networks,
  rpc,
  TransactionBuilder,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  isConnected as isFreighterConnected,
  requestAccess as requestFreighterAccess,
  signTransaction as signFreighterTransaction,
} from "@stellar/freighter-api";

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || "PASTE_DEPLOYED_TESTNET_CONTRACT_ID_HERE";
const RPC_URL = "https://soroban-testnet.stellar.org";
const EXPLORER_URL = "https://stellar.expert/explorer/testnet/tx";
const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";
const ALBEDO_SCRIPT_URL = "https://albedo.link/intent/lib/albedo.intent.js";
const CONTRACT_PLACEHOLDER_PATTERN = /^(|PASTE_|YOUR_|YOUR_DEPLOYED_TESTNET_CONTRACT_ID)/;
const hasContract = !CONTRACT_PLACEHOLDER_PATTERN.test(CONTRACT_ID);
const LOCAL_PAYMENTS_KEY = "payment-tracker.local-payments";

const server = new rpc.Server(RPC_URL);
const contract = hasContract ? new Contract(CONTRACT_ID) : null;

const state = {
  publicKey: "",
  wallet: "",
  albedoReady: false,
  albedoLoadError: "",
  albedoLoadPromise: null,
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

const submitButton = els.paymentForm.querySelector("button");

function readLocalPayments() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PAYMENTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalPayments(payments) {
  localStorage.setItem(LOCAL_PAYMENTS_KEY, JSON.stringify(payments));
}

function scrollToHashTarget(hash) {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  const target = document.getElementById(id);

  if (!target) {
    return;
  }

  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
}

function shortKey(key) {
  return key ? `${key.slice(0, 6)}...${key.slice(-6)}` : "";
}

function setMessage(message, isError = false) {
  els.formMessage.textContent = "";
  els.formMessage.append(message);
  els.formMessage.style.color = isError ? "#a13030" : "#176b55";
}

function setMessageLink(message, label, url) {
  els.formMessage.textContent = "";
  els.formMessage.style.color = "#a13030";
  els.formMessage.append(message, " ");

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  els.formMessage.append(link);
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

  if (/freighter.*not found|freighter.*not installed|freighter.*extension|freighter cannot/i.test(message)) {
    setMessageLink("Freighter is not installed or enabled.", "Install Freighter", FREIGHTER_INSTALL_URL);
    return;
  }

  if (/albedo.*not found|albedo.*not installed|albedo.*unavailable|albedo.*load/i.test(message)) {
    setMessage("Albedo could not open. Check your internet connection or try Freighter.", true);
    return;
  }

  if (/not found|not installed|extension/i.test(message)) {
    setMessage("Wallet not installed. Install Freighter or try Albedo Wallet.", true);
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

function getAlbedoApi() {
  return window.albedo || null;
}

function loadScript(src) {
  const existingScript = document.querySelector(`script[src="${src}"]`);

  if (existingScript) {
    if (existingScript.dataset.failed === "true") {
      existingScript.remove();
      state.albedoLoadPromise = null;
      return loadScript(src);
    }

    return new Promise((resolve, reject) => {
      if (existingScript.dataset.loaded === "true" || getAlbedoApi()) {
        resolve();
        return;
      }

      existingScript.addEventListener("load", resolve, { once: true });
      existingScript.addEventListener("error", reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      script.dataset.failed = "false";
      resolve();
    };
    script.onerror = () => {
      script.dataset.failed = "true";
      reject(new Error("Albedo popup script could not load."));
    };
    document.head.append(script);
  });
}

async function preloadAlbedoApi() {
  if (!state.albedoLoadPromise || state.albedoLoadError) {
    state.albedoLoadPromise = (async () => {
      state.albedoLoadError = "";
      await loadScript(ALBEDO_SCRIPT_URL);
      state.albedoReady = Boolean(getAlbedoApi());

      if (!state.albedoReady) {
        throw new Error("Albedo unavailable after script load.");
      }
    })().catch((error) => {
      state.albedoLoadError = String(error?.message || error || "Albedo failed to load.");
      state.albedoReady = false;
      throw error;
    });
  }

  return state.albedoLoadPromise;
}

async function ensureAlbedoApi() {
  await preloadAlbedoApi();

  const albedo = getAlbedoApi();
  if (!albedo) {
    throw new Error("Albedo unavailable after script load.");
  }

  return albedo;
}

async function getFreighterAddress() {
  const connection = await isFreighterConnected();
  if (connection.error || !connection.isConnected) {
    throw new Error("Freighter extension not found.");
  }

  const response = await requestFreighterAccess();
  if (response.error) {
    throw response.error;
  }

  return response.address;
}

async function getAlbedoAddress() {
  const albedo = await ensureAlbedoApi();

  if (typeof albedo.publicKey !== "function") {
    throw new Error("Albedo public key API unavailable.");
  }

  const response = await albedo.publicKey({
    network: "testnet",
    submit: false,
  });

  if (response.error) {
    throw response.error;
  }

  return response.pubkey || response.publicKey || response.address;
}

async function signWithFreighter(xdr) {
  const response = await signFreighterTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
    address: state.publicKey,
  });

  if (response.error) {
    throw response.error;
  }

  return response.signedTxXdr || response;
}

async function signWithAlbedo(xdr) {
  const albedo = await ensureAlbedoApi();

  if (typeof albedo.tx !== "function") {
    throw new Error("Albedo transaction API unavailable.");
  }

  const response = await albedo.tx({
    xdr,
    network: "testnet",
    submit: false,
  });

  if (response.error) {
    throw response.error;
  }

  return response.signed_envelope_xdr || response.signedTxXdr || response.xdr;
}

async function signWithSelectedWallet(xdr) {
  if (state.wallet === "albedo") {
    return signWithAlbedo(xdr);
  }

  return signWithFreighter(xdr);
}

async function connectWallet(wallet) {
  const address = wallet.id === "albedo" ? await getAlbedoAddress() : await getFreighterAddress();

  if (!address) {
    throw new Error("Wallet did not return an address.");
  }

  state.wallet = wallet.id;
  state.publicKey = address;
  els.walletStatus.textContent = `${wallet.name}: ${shortKey(address)}`;
  els.connectWallet.textContent = "Change wallet";
  els.walletDialog.close();
  setMessage(`${wallet.name} connected.`);
  await loadPayments();
  await startEventSync();
}

async function renderWalletOptions() {
  els.walletOptions.replaceChildren();

  const wallets = [
    {
      id: "freighter",
      name: "Freighter Wallet",
      description: "Browser extension signing",
    },
    {
      id: "albedo",
      name: "Albedo Wallet",
      description: state.albedoReady ? "Ready to open web popup" : "Open web popup",
    },
  ];

  wallets.forEach((wallet) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.wallet = wallet.id;
    button.innerHTML = `<strong>${wallet.name}</strong><span>${wallet.description}</span>`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await connectWallet(wallet);
      } catch (error) {
        handleWalletError(error);
        button.disabled = false;
      }
    });
    els.walletOptions.append(button);
  });
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
    throw new Error("Add the deployed contract id as VITE_CONTRACT_ID before creating payments.");
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
  const signedTxXdr = await signWithSelectedWallet(tx.toXDR());

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
    state.payments = readLocalPayments();
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

if (new URLSearchParams(window.location.search).get("walletDialog") === "open") {
  requestAnimationFrame(async () => {
    els.walletDialog.showModal();
    await renderWalletOptions();
  });
}

document.querySelectorAll('.site-nav a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const hash = link.getAttribute("href");

    if (window.location.hash !== hash) {
      history.pushState(null, "", hash);
    }

    scrollToHashTarget(hash);
  });
});

els.paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setMessage("");

  try {
    if (!hasContract) {
      const payment = {
        to: els.recipient.value,
        amount: els.amount.value,
        memo: els.memo.value,
        status: "local",
      };

      state.payments = [payment, ...readLocalPayments()];
      saveLocalPayments(state.payments);
      renderPayments();
      els.paymentForm.reset();
      els.amount.value = "10000000";
      setMessage("Payment saved locally. Add VITE_CONTRACT_ID to write it to Stellar testnet.");
      return;
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
    submitButton.disabled = !hasContract;
  }
});

els.contractStatus.textContent = hasContract ? shortKey(CONTRACT_ID) : "Local mode";
if (!hasContract) {
  setMessage("Local mode active. Add VITE_CONTRACT_ID when you are ready to write to Stellar testnet.");
}
renderPayments();

if (window.location.hash) {
  requestAnimationFrame(() => scrollToHashTarget(window.location.hash));
}
