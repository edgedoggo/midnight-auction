const MODULE_ID = "midnight-auction";
const AUCTION_NAME = "Midnight Auction";
const SOCKET = `module.${MODULE_ID}`;
const STATE_SETTING = "state";
const CATALOG_SETTING = "catalog";
const TIMER_SETTING = "timerMode";
const DEFAULT_INCREMENT_SETTING = "defaultIncrement";
const NPC_BID_INCREMENT_SETTING = "npcBidIncrement";
const NPC_BIDDERS_SETTING = "npcBidders";
const SCENE_IMAGES_SETTING = "sceneImages";
const FLOAT_POSITION_SETTING = "floatingButtonPosition";

function randomId() {
  return foundry.utils.randomID(16);
}

function defaultState() {
  return {
    status: "idle",
    roundId: null,
    itemId: null,
    currentPrice: 0,
    endsAt: null,
    winnerUserId: null,
    winnerActorUuid: null,
    npcBidStreak: {
      itemId: null,
      count: 0,
      bidderId: null
    },
    bids: [],
    message: "The auction house is waiting for the next lot."
  };
}

function defaultNpcBidders() {
  return [
    "Lady Vex Marrow",
    "Master Orris Pike",
    "The Brass Veil",
    "Professor Nettlewick",
    "Dame Sable",
    "Brother Coin",
    "The Red Ledger",
    "Silas Moon",
    "Madam Thrice",
    "Old Crown"
  ].map((name) => ({
    id: randomId(),
    name,
    img: "icons/svg/mystery-man.svg",
    maxBid: 0
  }));
}

function defaultCatalog() {
  return {
    rounds: [
      {
        id: randomId(),
        number: 1,
        title: "Round 1",
        items: [
          {
            id: randomId(),
            name: "Velvet-Wrapped Curiosity",
            img: "icons/commodities/treasure/trinket-wing-white.webp",
            description: "A mysterious first lot. Rename it, set a price, and start the bidding.",
            startingPrice: 10,
            increment: 5
          }
        ]
      }
    ]
  };
}

function getState() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, STATE_SETTING) ?? defaultState());
}

function getCatalog() {
  const catalog = foundry.utils.deepClone(game.settings.get(MODULE_ID, CATALOG_SETTING) ?? {});
  if (!Array.isArray(catalog.rounds) || !catalog.rounds.length) return defaultCatalog();
  return catalog;
}

function getNpcBidders() {
  const bidders = foundry.utils.deepClone(game.settings.get(MODULE_ID, NPC_BIDDERS_SETTING) ?? []);
  const normalized = Array.isArray(bidders) ? bidders.slice(0, 10) : [];
  while (normalized.length < 10) {
    const defaults = defaultNpcBidders();
    normalized.push(defaults[normalized.length]);
  }
  return normalized.map((bidder, index) => ({
    id: bidder.id || randomId(),
    name: bidder.name || `NPC Bidder ${index + 1}`,
    img: bidder.img || "icons/svg/mystery-man.svg",
    maxBid: Math.max(0, Number(bidder.maxBid) || 0)
  }));
}

async function setNpcBidders(bidders, { ping = true } = {}) {
  await game.settings.set(MODULE_ID, NPC_BIDDERS_SETTING, bidders.slice(0, 10));
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "npc-bidders" });
}

async function setCatalog(catalog, { ping = true } = {}) {
  await game.settings.set(MODULE_ID, CATALOG_SETTING, catalog);
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "catalog" });
}

async function setState(nextState, { ping = true } = {}) {
  const state = foundry.utils.mergeObject(defaultState(), nextState ?? {}, { inplace: false });
  await game.settings.set(MODULE_ID, STATE_SETTING, state);
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "state" });
  return state;
}

function sceneImages() {
  const raw = game.settings.get(MODULE_ID, SCENE_IMAGES_SETTING) || "";
  const values = raw.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  return {
    idle: values[0] || "icons/environment/settlement/market-stall.webp",
    round: values[1] || values[0] || "icons/environment/settlement/market-stall.webp",
    item: values[2] || values[1] || values[0] || "icons/sundries/lights/candle-unlit-grey.webp",
    sold: values[3] || values[2] || values[0] || "icons/commodities/currency/coins-assorted-mix-gold.webp"
  };
}

function getCurrencyGp(actor) {
  return Number(foundry.utils.getProperty(actor, "system.currency.gp") ?? 0);
}

async function setCurrencyGp(actor, value) {
  return actor.update({ "system.currency.gp": Math.max(0, Number(value) || 0) });
}

function actorForUser(user) {
  return user.character ?? null;
}

function findRound(catalog, roundId) {
  return catalog.rounds.find((round) => round.id === roundId) ?? null;
}

function findLot(catalog, itemId) {
  for (const round of catalog.rounds) {
    const item = round.items.find((lot) => lot.id === itemId);
    if (item) return { round, item };
  }
  return { round: null, item: null };
}

function activeLot(catalog, state = getState()) {
  if (!state.itemId) return { round: null, item: null };
  return findLot(catalog, state.itemId);
}

function nextBidFor(item, state) {
  if (!item) return 0;
  const current = Number(state.currentPrice) || 0;
  const increment = Number(item.increment) || Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 1;
  return state.bids?.length ? current + increment : Math.max(current, Number(item.startingPrice) || 0);
}

function nextNpcBidFor(item, state) {
  if (!item) return 0;
  const current = Number(state.currentPrice) || 0;
  const increment = Number(game.settings.get(MODULE_ID, NPC_BID_INCREMENT_SETTING)) || 1;
  return state.bids?.length ? current + increment : Math.max(current, Number(item.startingPrice) || 0);
}

function timerMode() {
  return String(game.settings.get(MODULE_ID, TIMER_SETTING) || "10");
}

function timerSeconds() {
  const mode = timerMode();
  if (mode === "sudden") return 10;
  return Number(mode) || 10;
}

function bidResetsTimer() {
  return timerMode() !== "sudden";
}

function bidRows(state) {
  return (state.bids ?? []).slice(0, 8);
}

function renderAuctionApps() {
  for (const app of Object.values(ui.windows)) {
    if (app instanceof MidnightAuctionApp) app.render(false);
  }
}

function isPrimaryActiveGM() {
  const activeGms = game.users.filter((user) => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id));
  return activeGms[0]?.id === game.user.id;
}

function notifyAll(message) {
  ui.notifications.info(message);
  game.socket.emit(SOCKET, { type: "notify", message });
}

async function postBidChat(bidderName, amount, itemName) {
  const content = `<p><strong>${bidderName}</strong> bids <strong>${amount} gp</strong> on <em>${itemName}</em>.</p>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: AUCTION_NAME }),
    content
  });
}

async function ensureMacros() {
  if (!game.user.isGM) return;
  const macroData = [
    {
      name: "Midnight Auction",
      img: "icons/commodities/currency/coins-assorted-mix-gold.webp",
      command: `game.modules.get("${MODULE_ID}").api.open();`
    },
    {
      name: "Open Midnight Auction",
      img: "icons/commodities/currency/coins-plain-stack-gold.webp",
      command: `game.modules.get("${MODULE_ID}").api.open();`
    }
  ];

  for (const data of macroData) {
    const existing = game.macros.find((macro) => macro.name === data.name);
    if (existing) continue;
    await Macro.create({
      ...data,
      type: "script",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    });
  }
}

function addFloatingButton() {
  if (document.getElementById("midnight-auction-float")) return;

  const button = document.createElement("button");
  button.id = "midnight-auction-float";
  button.type = "button";
  button.innerHTML = `<i class="fas fa-gavel"></i>`;
  button.title = game.user.isGM ? "Open Midnight Auction builder" : "Open Midnight Auction";
  button.setAttribute("aria-label", "Open Midnight Auction");

  const position = game.settings.get(MODULE_ID, FLOAT_POSITION_SETTING) || {};
  if (Number.isFinite(position.left) && Number.isFinite(position.top)) {
    button.style.left = `${position.left}px`;
    button.style.top = `${position.top}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
  }

  let drag = null;
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;

    const left = Math.min(window.innerWidth - button.offsetWidth - 8, Math.max(8, drag.left + dx));
    const top = Math.min(window.innerHeight - button.offsetHeight - 8, Math.max(8, drag.top + dy));
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.style.right = "auto";
    button.style.bottom = "auto";
  });

  button.addEventListener("pointerup", async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    button.releasePointerCapture(event.pointerId);

    const rect = button.getBoundingClientRect();
    await game.settings.set(MODULE_ID, FLOAT_POSITION_SETTING, {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    });

    if (!wasDrag) openAuction();
  });

  document.body.appendChild(button);
}

class MidnightAuctionApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "midnight-auction",
      classes: ["midnight-auction-window"],
      title: AUCTION_NAME,
      template: `modules/${MODULE_ID}/templates/auction-app.hbs`,
      width: 900,
      height: "auto",
      resizable: true
    });
  }

  constructor(options = {}) {
    super(options);
    this._clock = null;
    this._ending = false;
    this._selectedRoundId = null;
  }

  async getData() {
    const catalog = getCatalog();
    const state = getState();
    const { round, item: activeItem } = activeLot(catalog, state);
    const item = activeItem ?? {
      id: null,
      name: "No lot is live",
      img: "icons/svg/item-bag.svg",
      description: "The GM has not started a lot yet."
    };
    const images = sceneImages();
    const now = Date.now();
    const timeLeft = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
    const goldActor = actorForUser(game.user);
    const gold = goldActor ? getCurrencyGp(goldActor) : 0;
    const nextBid = nextBidFor(activeItem, state);
    const selectedRound = this._selectedRound(catalog, state);
    const npcBidders = getNpcBidders();

    return {
      isGM: game.user.isGM,
      title: state.status === "item" ? "Bidding Is Live" : AUCTION_NAME,
      subtitle: state.message,
      sceneImage: activeItem?.sceneImg || images[state.status] || images.idle,
      timerLabel: state.status === "item" ? "Seconds Left" : "Timer",
      timeLeft: state.status === "item" ? timeLeft : "--",
      urgent: state.status === "item" && timeLeft <= 3,
      item,
      itemDescription: activeItem ? await TextEditor.enrichHTML(activeItem.description || "", { async: true }) : "<p>The velvet curtain has not lifted yet.</p>",
      currentPrice: Number(state.currentPrice) || 0,
      nextBid,
      nextNpcBid: nextNpcBidFor(activeItem, state),
      gold,
      canBid: Boolean(activeItem && state.status === "item" && goldActor && gold >= nextBid),
      canNpcBid: Boolean(activeItem && state.status === "item" && npcBidders.some((bidder) => bidder.name?.trim())),
      bids: bidRows(state),
      npcBidders,
      rounds: catalog.rounds.map((catalogRound) => ({
        ...catalogRound,
        active: state.roundId === catalogRound.id,
        selected: selectedRound?.id === catalogRound.id,
        items: catalogRound.items.map((lot) => ({
          ...lot,
          active: state.itemId === lot.id,
          increment: Number(lot.increment) || Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 1
        }))
      })),
      selectedRound: selectedRound
        ? {
          ...selectedRound,
          active: state.roundId === selectedRound.id,
          items: selectedRound.items.map((lot) => ({
            ...lot,
            active: state.itemId === lot.id,
            increment: Number(lot.increment) || Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 1
          }))
        }
        : null,
      activeRoundTitle: round?.title || ""
    };
  }

  _selectedRound(catalog, state) {
    const selected = catalog.rounds.find((round) => round.id === this._selectedRoundId);
    if (selected) return selected;
    const stateRound = catalog.rounds.find((round) => round.id === state.roundId);
    if (stateRound) {
      this._selectedRoundId = stateRound.id;
      return stateRound;
    }
    const first = catalog.rounds[0] ?? null;
    this._selectedRoundId = first?.id ?? null;
    return first;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action='refresh']").on("click", () => this.render(false));
    html.find("[data-action='stop-auction']").on("click", () => this._onStopAuction());
    html.find("[data-action='select-round']").on("click", (event) => this._onSelectRound(event));
    html.find("[data-action='add-round']").on("click", () => this._onAddRound());
    html.find("[data-action='delete-round']").on("click", (event) => this._onDeleteRound(event));
    html.find("[data-action='add-item']").on("click", (event) => this._onAddItem(event));
    html.find("[data-action='delete-item']").on("click", (event) => this._onDeleteItem(event));
    html.find("[data-action='start-round']").on("click", (event) => this._onStartRound(event));
    html.find("[data-action='end-round']").on("click", (event) => this._onEndRound(event));
    html.find("[data-action='start-item']").on("click", (event) => this._onStartItem(event));
    html.find("[data-action='end-item']").on("click", (event) => this._onEndItem(event));
    html.find("[data-action='npc-bid']").on("click", () => this._onNpcBid());
    html.find("[data-action='bid']").on("click", () => this._onBid());
    html.find("[data-field]").on("change", (event) => this._onFieldChange(event));
    html.find("[data-npc-field]").on("change", (event) => this._onNpcFieldChange(event));
    html.find("[data-npc-index]").on("dragover", (event) => event.preventDefault());
    html.find("[data-npc-index]").on("drop", (event) => this._onNpcDrop(event));
  }

  async _render(...args) {
    await super._render(...args);
    this._startClock();
  }

  close(options) {
    if (this._clock) window.clearInterval(this._clock);
    this._clock = null;
    return super.close(options);
  }

  _startClock() {
    if (this._clock) window.clearInterval(this._clock);
    this._clock = window.setInterval(() => {
      const state = getState();
      if (state.status === "item" && state.endsAt && Date.now() >= state.endsAt && game.user.isGM && isPrimaryActiveGM() && !this._ending) {
        this._onEndItem({ currentTarget: { dataset: { itemId: state.itemId } } });
      } else {
        this.render(false);
      }
    }, 1000);
  }

  async _onStopAuction() {
    if (!game.user.isGM) return;
    await setState({ ...defaultState(), message: "The Midnight Auction closes its doors." });
    notifyAll("The Midnight Auction has ended.");
  }

  _onSelectRound(event) {
    if (!game.user.isGM) return;
    this._selectedRoundId = event.currentTarget.dataset.roundId;
    this.render(false);
  }

  async _onAddRound() {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const nextNumber = Math.max(0, ...catalog.rounds.map((round) => Number(round.number) || 0)) + 1;
    const round = {
      id: randomId(),
      number: nextNumber,
      title: `Round ${nextNumber}`,
      items: []
    };
    catalog.rounds.push(round);
    this._selectedRoundId = round.id;
    await setCatalog(catalog);
  }

  async _onDeleteRound(event) {
    if (!game.user.isGM) return;
    const roundId = event.currentTarget.dataset.roundId;
    const catalog = getCatalog();
    catalog.rounds = catalog.rounds.filter((round) => round.id !== roundId);
    if (!catalog.rounds.length) catalog.rounds = defaultCatalog().rounds;
    if (this._selectedRoundId === roundId) this._selectedRoundId = catalog.rounds[0]?.id ?? null;

    const state = getState();
    if (state.roundId === roundId) await setState(defaultState(), { ping: false });
    await setCatalog(catalog);
  }

  async _onAddItem(event) {
    if (!game.user.isGM) return;
    const roundId = event.currentTarget.dataset.roundId;
    const catalog = getCatalog();
    const round = findRound(catalog, roundId);
    if (!round) return;

    round.items.push({
      id: randomId(),
      name: "New Auction Lot",
      img: "icons/svg/item-bag.svg",
      sceneImg: "",
      description: "Describe this lot for your bidders.",
      startingPrice: 10,
      increment: Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 10
    });
    await setCatalog(catalog);
  }

  async _onDeleteItem(event) {
    if (!game.user.isGM) return;
    const itemId = event.currentTarget.dataset.itemId;
    const catalog = getCatalog();
    for (const round of catalog.rounds) {
      round.items = round.items.filter((item) => item.id !== itemId);
    }

    const state = getState();
    if (state.itemId === itemId) await setState(defaultState(), { ping: false });
    await setCatalog(catalog);
  }

  async _onStartRound(event) {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const round = findRound(catalog, event.currentTarget.dataset.roundId);
    if (!round) return;

    await setState({
      ...getState(),
      status: "round",
      roundId: round.id,
      itemId: null,
      currentPrice: 0,
      endsAt: null,
      winnerUserId: null,
      winnerActorUuid: null,
      bids: [],
      message: `${round.title || `Round ${round.number}`} is now live. The next lot is coming up.`
    });
    notifyAll(`${round.title || `Round ${round.number}`} of the Midnight Auction is live.`);
  }

  async _onEndRound(event) {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const round = findRound(catalog, event.currentTarget.dataset.roundId);
    if (!round) return;

    await setState({
      ...getState(),
      status: "idle",
      roundId: round.id,
      itemId: null,
      currentPrice: 0,
      endsAt: null,
      bids: [],
      message: `${round.title || `Round ${round.number}`} has ended.`
    });
    notifyAll(`${round.title || `Round ${round.number}`} has ended.`);
  }

  async _onStartItem(event) {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const { round, item } = findLot(catalog, event.currentTarget.dataset.itemId);
    if (!round || !item) return;

    const startingPrice = Number(item.startingPrice) || 0;
    await setState({
      status: "item",
      roundId: round.id,
      itemId: item.id,
      currentPrice: startingPrice,
      endsAt: Date.now() + timerSeconds() * 1000,
      winnerUserId: null,
      winnerActorUuid: null,
      npcBidStreak: {
        itemId: item.id,
        count: 0,
        bidderId: null
      },
      bids: [],
      message: `${item.name} is on the block. Opening bid: ${startingPrice} gp.`
    });
    notifyAll(`${item.name} is live at the Midnight Auction.`);
  }

  async _onEndItem(event) {
    if (!game.user.isGM || !isPrimaryActiveGM()) return;
    this._ending = true;
    try {
      const catalog = getCatalog();
      const state = getState();
      const itemId = event.currentTarget.dataset.itemId || state.itemId;
      const { item } = findLot(catalog, itemId);
      if (!item || state.itemId !== itemId) return;

      const winningBid = state.bids?.[0];
      if (winningBid) await this._settleWinningBid(winningBid);

      const message = winningBid
        ? `${winningBid.bidderName} wins ${item.name} for ${winningBid.amount} gp.`
        : `${item.name} received no bids.`;
      await setState({
        ...state,
        status: "sold",
        endsAt: null,
        message
      });
      notifyAll(message);
    } finally {
      this._ending = false;
    }
  }

  async _settleWinningBid(winningBid) {
    if (!winningBid.actorUuid) return;
    const winnerActor = await fromUuid(winningBid.actorUuid);
    if (!winnerActor) return;
    const gold = getCurrencyGp(winnerActor);
    await setCurrencyGp(winnerActor, gold - winningBid.amount);
  }

  async _onNpcBid() {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const state = getState();
    const { item } = activeLot(catalog, state);
    if (!item || state.status !== "item") return ui.notifications.warn("Start a lot before placing an NPC bid.");

    const bidders = getNpcBidders().filter((bidder) => bidder.name?.trim());
    if (!bidders.length) return ui.notifications.warn("Add at least one NPC bidder first.");

    const streak = state.npcBidStreak?.itemId === state.itemId
      ? foundry.utils.deepClone(state.npcBidStreak)
      : { itemId: state.itemId, count: 0, bidderId: null };
    const amount = nextNpcBidFor(item, state);
    const focused = bidders.find((bidder) => bidder.id === streak.bidderId);
    const guaranteed = bidders.filter((bidder) => Number(bidder.maxBid) >= amount);
    const focusedGuaranteed = focused && Number(focused.maxBid) >= amount ? focused : null;
    const bidder = focusedGuaranteed
      || (guaranteed.length ? guaranteed[Math.floor(Math.random() * guaranteed.length)] : null)
      || (streak.count >= 2 && focused ? focused : bidders[Math.floor(Math.random() * bidders.length)]);
    const nextCount = streak.count + 1;
    const focusId = Number(bidder.maxBid) >= amount || nextCount >= 3 ? bidder.id : streak.bidderId;
    const bid = {
      bidderName: bidder.name,
      npcBidderId: bidder.id,
      amount,
      time: Date.now(),
      isNpc: true
    };

    const nextState = {
      ...state,
      currentPrice: amount,
      endsAt: bidResetsTimer() ? Date.now() + timerSeconds() * 1000 : state.endsAt,
      winnerUserId: null,
      winnerActorUuid: null,
      npcBidStreak: {
        itemId: state.itemId,
        count: nextCount,
        bidderId: focusId
      },
      bids: [bid, ...(state.bids ?? [])].slice(0, 20),
      message: `${bidder.name} raises the room to ${amount} gp.`
    };

    await setState(nextState);
    await postBidChat(bidder.name, amount, item.name);
    notifyAll(`${bidder.name} bids ${amount} gp on ${item.name}.`);
  }

  async _onBid() {
    const actor = actorForUser(game.user);
    if (!actor) return ui.notifications.warn("Assign your player character before bidding.");
    game.socket.emit(SOCKET, {
      type: "bid",
      userId: game.user.id,
      actorUuid: actor.uuid
    });
  }

  async _onFieldChange(event) {
    if (!game.user.isGM) return;
    const field = event.currentTarget.dataset.field;
    const roundId = event.currentTarget.dataset.roundId;
    const itemId = event.currentTarget.dataset.itemId;
    const catalog = getCatalog();

    if (roundId && !itemId) {
      const round = findRound(catalog, roundId);
      if (!round) return;
      if (field === "number") round.number = Math.max(1, Number(event.currentTarget.value) || 1);
      if (field === "title") round.title = event.currentTarget.value.trim() || `Round ${round.number || 1}`;
    }

    if (itemId) {
      const { item } = findLot(catalog, itemId);
      if (!item) return;
      if (["startingPrice", "increment"].includes(field)) item[field] = Math.max(field === "increment" ? 1 : 0, Number(event.currentTarget.value) || 0);
      if (["name", "img", "sceneImg", "description"].includes(field)) item[field] = event.currentTarget.value;
    }

    catalog.rounds.sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    await setCatalog(catalog);
  }

  async _onNpcFieldChange(event) {
    if (!game.user.isGM) return;
    const index = Number(event.currentTarget.dataset.npcIndex);
    const field = event.currentTarget.dataset.npcField;
    const bidders = getNpcBidders();
    if (!bidders[index]) return;
    if (field === "maxBid") bidders[index][field] = Math.max(0, Number(event.currentTarget.value) || 0);
    else bidders[index][field] = event.currentTarget.value;
    await setNpcBidders(bidders);
  }

  async _onNpcDrop(event) {
    if (!game.user.isGM) return;
    event.preventDefault();
    const index = Number(event.currentTarget.dataset.npcIndex);
    const bidders = getNpcBidders();
    if (!bidders[index]) return;

    let data = null;
    try {
      data = JSON.parse(event.originalEvent?.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("text/plain") || "{}");
    } catch (_err) {
      return;
    }

    const actor = data.uuid ? await fromUuid(data.uuid) : null;
    if (!actor) return;
    bidders[index] = {
      id: bidders[index].id || randomId(),
      name: actor.name,
      img: actor.img || "icons/svg/mystery-man.svg",
      maxBid: bidders[index].maxBid || 0
    };
    await setNpcBidders(bidders);
  }
}

async function processBid(data) {
  if (!game.user.isGM || !isPrimaryActiveGM()) return;
  const bidder = game.users.get(data.userId);
  const bidderActor = await fromUuid(data.actorUuid);
  const catalog = getCatalog();
  const state = getState();
  const { item } = activeLot(catalog, state);
  if (!bidder || !bidderActor || !item || state.status !== "item") return;

  const amount = nextBidFor(item, state);
  if (getCurrencyGp(bidderActor) < amount) {
    game.socket.emit(SOCKET, { type: "notify", userId: data.userId, message: `Not enough gold to bid ${amount} gp.` });
    return;
  }

  const bid = {
    bidderName: bidder.name,
    userId: bidder.id,
    actorUuid: bidderActor.uuid,
    amount,
    time: Date.now()
  };

  const nextState = {
    ...state,
    currentPrice: amount,
    endsAt: bidResetsTimer() ? Date.now() + timerSeconds() * 1000 : state.endsAt,
    winnerUserId: bidder.id,
    winnerActorUuid: bidderActor.uuid,
    bids: [bid, ...(state.bids ?? [])].slice(0, 20),
    message: `${bidder.name} bids ${amount} gp. Going once...`
  };
  await setState(nextState);
  await postBidChat(bidder.name, amount, item.name);
  notifyAll(`${bidder.name} bids ${amount} gp on ${item.name}.`);
}

function openAuction() {
  const existing = Object.values(ui.windows).find((app) => app instanceof MidnightAuctionApp);
  if (existing) return existing.render(true);
  return new MidnightAuctionApp().render(true);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, STATE_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultState()
  });

  game.settings.register(MODULE_ID, CATALOG_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultCatalog()
  });

  game.settings.register(MODULE_ID, TIMER_SETTING, {
    name: "Bid Timer Mode",
    hint: "How long each accepted bid resets the timer. Sudden Death starts each lot at 10 seconds and bids do not reset it.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "5": "5 seconds",
      "10": "10 seconds",
      "15": "15 seconds",
      "30": "30 seconds",
      sudden: "Sudden Death: 10 seconds, no resets"
    },
    default: "10"
  });

  game.settings.register(MODULE_ID, DEFAULT_INCREMENT_SETTING, {
    name: "Default Bid Increment",
    hint: "Default gold increase for new lots.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(MODULE_ID, NPC_BID_INCREMENT_SETTING, {
    name: "NPC Bid Increment",
    hint: "How much an NPC bid raises the current price when the GM presses NPC Bid.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(MODULE_ID, NPC_BIDDERS_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultNpcBidders()
  });

  game.settings.register(MODULE_ID, SCENE_IMAGES_SETTING, {
    name: "Scene Images",
    hint: "Optional image paths, one per line: idle, round live, item live, sold.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, FLOAT_POSITION_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
});

Hooks.once("ready", async () => {
  game.socket.on(SOCKET, async (data) => {
    if (data.type === "bid") return processBid(data);
    if (["state", "catalog", "npc-bidders"].includes(data.type)) return renderAuctionApps();
    if (data.type === "notify") {
      if (!data.userId || data.userId === game.user.id) ui.notifications.info(data.message);
      return renderAuctionApps();
    }
    return null;
  });

  addFloatingButton();
  await ensureMacros();
});

Hooks.on("renderSceneControls", () => addFloatingButton());
Hooks.on("canvasReady", () => addFloatingButton());

game.modules.get(MODULE_ID).api = {
  open: openAuction,
  reset: () => setState(defaultState()),
  getCatalog,
  setCatalog
};
