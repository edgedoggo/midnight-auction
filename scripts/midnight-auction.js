const MODULE_ID = "midnight-auction";
const AUCTION_ACTOR_NAME = "Midnight Auction";
const SOCKET = `module.${MODULE_ID}`;
const STATE_SETTING = "state";
const ACTOR_SETTING = "auctionActorUuid";
const TIMER_SETTING = "timerSeconds";
const DEFAULT_INCREMENT_SETTING = "defaultIncrement";
const SCENE_IMAGES_SETTING = "sceneImages";

function defaultState() {
  return {
    status: "idle",
    round: null,
    itemId: null,
    currentPrice: 0,
    endsAt: null,
    winnerUserId: null,
    winnerActorUuid: null,
    bids: [],
    message: "The auction house is waiting for the next lot."
  };
}

function getState() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, STATE_SETTING) ?? defaultState());
}

async function setState(nextState, { ping = true } = {}) {
  const state = foundry.utils.mergeObject(defaultState(), nextState ?? {}, { inplace: false });
  await game.settings.set(MODULE_ID, STATE_SETTING, state);
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "state", state });
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

async function getAuctionActor() {
  const uuid = game.settings.get(MODULE_ID, ACTOR_SETTING);
  if (!uuid) return null;
  try {
    return await fromUuid(uuid);
  } catch (_err) {
    return null;
  }
}

function getCurrencyGp(actor) {
  return Number(foundry.utils.getProperty(actor, "system.currency.gp") ?? 0);
}

async function setCurrencyGp(actor, value) {
  return actor.update({ "system.currency.gp": Math.max(0, Number(value) || 0) });
}

function itemFlag(item, key, fallback) {
  return item.getFlag(MODULE_ID, key) ?? fallback;
}

function itemRound(item) {
  return Number(itemFlag(item, "round", 1)) || 1;
}

function itemStartingPrice(item) {
  return Number(itemFlag(item, "startingPrice", foundry.utils.getProperty(item, "system.price.value") ?? 10)) || 0;
}

function itemIncrement(item) {
  return Number(itemFlag(item, "increment", game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING))) || 1;
}

function getActiveItem(actor, state = getState()) {
  if (!actor || !state.itemId) return null;
  return actor.items.get(state.itemId) ?? null;
}

function nextBidFor(item, state) {
  if (!item) return 0;
  const current = Number(state.currentPrice) || 0;
  const increment = itemIncrement(item);
  return state.bids?.length ? current + increment : Math.max(current, itemStartingPrice(item));
}

function stripDescription(item) {
  return foundry.utils.getProperty(item, "system.description.value")
    || foundry.utils.getProperty(item, "system.description")
    || "<p>A mysterious lot from the Midnight Auction.</p>";
}

function actorForUser(user) {
  return user.character ?? null;
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

async function createAuctionActor() {
  let actor = game.actors.find((a) => a.name === AUCTION_ACTOR_NAME);
  if (!actor) {
    actor = await Actor.create({
      name: AUCTION_ACTOR_NAME,
      type: "npc",
      img: "icons/environment/settlement/market-stall.webp"
    });
  }

  await game.settings.set(MODULE_ID, ACTOR_SETTING, actor.uuid);
  ui.notifications.info("Midnight Auction actor is ready. Drag auction items onto it.");
  return actor;
}

async function ensureMacro() {
  if (!game.user.isGM) return;
  const existing = game.macros.find((macro) => macro.name === AUCTION_ACTOR_NAME);
  if (existing) return;

  await Macro.create({
    name: AUCTION_ACTOR_NAME,
    type: "script",
    img: "icons/commodities/currency/coins-assorted-mix-gold.webp",
    command: `game.modules.get("${MODULE_ID}").api.open();`
  });
}

async function postBidChat(bidderName, amount, itemName) {
  const content = `<p><strong>${bidderName}</strong> bids <strong>${amount} gp</strong> on <em>${itemName}</em>.</p>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: AUCTION_ACTOR_NAME }),
    content
  });
}

class MidnightAuctionApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "midnight-auction",
      classes: ["midnight-auction-window"],
      title: AUCTION_ACTOR_NAME,
      template: `modules/${MODULE_ID}/templates/auction-app.hbs`,
      width: 840,
      height: "auto",
      resizable: true
    });
  }

  constructor(options = {}) {
    super(options);
    this._clock = null;
    this._ending = false;
  }

  async getData() {
    const state = getState();
    const actor = await getAuctionActor();
    const item = getActiveItem(actor, state) ?? {
      id: null,
      name: "No lot is live",
      img: "icons/svg/item-bag.svg"
    };
    const activeItem = actor ? getActiveItem(actor, state) : null;
    const images = sceneImages();
    const now = Date.now();
    const timeLeft = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
    const goldActor = actorForUser(game.user);
    const gold = goldActor ? getCurrencyGp(goldActor) : 0;
    const currentPrice = Number(state.currentPrice) || 0;
    const nextBid = nextBidFor(activeItem, state);

    return {
      actor,
      isGM: game.user.isGM,
      title: state.status === "item" ? "Bidding Is Live" : "Midnight Auction",
      subtitle: state.message,
      sceneImage: images[state.status] || images.idle,
      timerLabel: state.status === "item" ? "Seconds Left" : "Timer",
      timeLeft: state.status === "item" ? timeLeft : "--",
      urgent: state.status === "item" && timeLeft <= 3,
      item,
      itemDescription: activeItem ? stripDescription(activeItem) : "<p>The velvet curtain has not lifted yet.</p>",
      currentPrice,
      nextBid,
      gold,
      canBid: Boolean(activeItem && state.status === "item" && goldActor && gold >= nextBid),
      bids: bidRows(state),
      rounds: actor ? this._roundsFor(actor, state) : []
    };
  }

  _roundsFor(actor, state) {
    const byRound = new Map();
    for (const item of actor.items) {
      const round = itemRound(item);
      if (!byRound.has(round)) byRound.set(round, []);
      byRound.get(round).push({
        id: item.id,
        name: item.name,
        img: item.img,
        round,
        startingPrice: itemStartingPrice(item),
        increment: itemIncrement(item),
        active: state.itemId === item.id
      });
    }

    return [...byRound.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, items]) => ({
        number,
        items: items.sort((a, b) => a.name.localeCompare(b.name))
      }));
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action='create-actor']").on("click", () => this._onCreateActor());
    html.find("[data-action='open-actor']").on("click", () => this._onOpenActor());
    html.find("[data-action='refresh']").on("click", () => this.render(false));
    html.find("[data-action='stop-auction']").on("click", () => this._onStopAuction());
    html.find("[data-action='start-round']").on("click", (event) => this._onStartRound(event));
    html.find("[data-action='end-round']").on("click", (event) => this._onEndRound(event));
    html.find("[data-action='start-item']").on("click", (event) => this._onStartItem(event));
    html.find("[data-action='end-item']").on("click", (event) => this._onEndItem(event));
    html.find("[data-action='bid']").on("click", () => this._onBid());
    html.find("[data-action='item-round'], [data-action='item-start'], [data-action='item-increment']")
      .on("change", (event) => this._onItemField(event));
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
      if (state.status === "item" && state.endsAt && Date.now() >= state.endsAt && game.user.isGM && !this._ending) {
        this._onEndItem({ currentTarget: { dataset: { itemId: state.itemId } } });
      } else {
        this.render(false);
      }
    }, 1000);
  }

  async _onCreateActor() {
    if (!game.user.isGM) return;
    await createAuctionActor();
    this.render(false);
  }

  async _onOpenActor() {
    const actor = await getAuctionActor();
    actor?.sheet?.render(true);
  }

  async _onStopAuction() {
    if (!game.user.isGM) return;
    await setState({ ...defaultState(), message: "The Midnight Auction closes its doors." });
    notifyAll("The Midnight Auction has ended.");
  }

  async _onStartRound(event) {
    if (!game.user.isGM) return;
    const round = Number(event.currentTarget.dataset.round);
    await setState({
      ...getState(),
      status: "round",
      round,
      itemId: null,
      currentPrice: 0,
      endsAt: null,
      winnerUserId: null,
      winnerActorUuid: null,
      bids: [],
      message: `Round ${round} is now live. The next lot is coming up.`
    });
    notifyAll(`Round ${round} of the Midnight Auction is live.`);
  }

  async _onEndRound(event) {
    if (!game.user.isGM) return;
    const round = Number(event.currentTarget.dataset.round);
    await setState({
      ...getState(),
      status: "idle",
      round,
      itemId: null,
      currentPrice: 0,
      endsAt: null,
      bids: [],
      message: `Round ${round} has ended.`
    });
    notifyAll(`Round ${round} has ended.`);
  }

  async _onStartItem(event) {
    if (!game.user.isGM) return;
    const actor = await getAuctionActor();
    if (!actor) return ui.notifications.warn("Create the Midnight Auction actor first.");

    const itemId = event.currentTarget.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item) return;

    const startingPrice = itemStartingPrice(item);
    const timerSeconds = Number(game.settings.get(MODULE_ID, TIMER_SETTING)) || 10;
    await setState({
      status: "item",
      round: itemRound(item),
      itemId,
      currentPrice: startingPrice,
      endsAt: Date.now() + timerSeconds * 1000,
      winnerUserId: null,
      winnerActorUuid: null,
      bids: [],
      message: `${item.name} is on the block. Opening bid: ${startingPrice} gp.`
    });
    notifyAll(`${item.name} is live at the Midnight Auction.`);
  }

  async _onEndItem(event) {
    if (!game.user.isGM) return;
    this._ending = true;
    try {
      const actor = await getAuctionActor();
      const state = getState();
      const itemId = event.currentTarget.dataset.itemId || state.itemId;
      const item = actor?.items.get(itemId);
      if (!item || state.itemId !== itemId) return;

      const winningBid = state.bids?.[0];
      if (winningBid) await this._settleWinningBid(actor, item, winningBid);

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

  async _settleWinningBid(auctionActor, item, winningBid) {
    const winnerActor = await fromUuid(winningBid.actorUuid);
    if (!winnerActor) return;

    const gold = getCurrencyGp(winnerActor);
    await setCurrencyGp(winnerActor, gold - winningBid.amount);
    const itemData = item.toObject();
    delete itemData._id;
    await winnerActor.createEmbeddedDocuments("Item", [itemData]);
    await auctionActor.deleteEmbeddedDocuments("Item", [item.id]);
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

  async _onItemField(event) {
    if (!game.user.isGM) return;
    const actor = await getAuctionActor();
    const item = actor?.items.get(event.currentTarget.dataset.itemId);
    if (!item) return;

    const value = Math.max(0, Number(event.currentTarget.value) || 0);
    const action = event.currentTarget.dataset.action;
    const updates = {};
    if (action === "item-round") updates[`flags.${MODULE_ID}.round`] = Math.max(1, value);
    if (action === "item-start") updates[`flags.${MODULE_ID}.startingPrice`] = value;
    if (action === "item-increment") updates[`flags.${MODULE_ID}.increment`] = Math.max(1, value);
    await item.update(updates);
    this.render(false);
  }
}

async function processBid(data) {
  if (!game.user.isGM || !isPrimaryActiveGM()) return;
  const bidder = game.users.get(data.userId);
  const bidderActor = await fromUuid(data.actorUuid);
  const auctionActor = await getAuctionActor();
  const state = getState();
  const item = getActiveItem(auctionActor, state);
  if (!bidder || !bidderActor || !auctionActor || !item || state.status !== "item") return;

  const amount = nextBidFor(item, state);
  if (getCurrencyGp(bidderActor) < amount) {
    game.socket.emit(SOCKET, { type: "notify", userId: data.userId, message: `Not enough gold to bid ${amount} gp.` });
    return;
  }

  const timerSeconds = Number(game.settings.get(MODULE_ID, TIMER_SETTING)) || 10;
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
    endsAt: Date.now() + timerSeconds * 1000,
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
  new MidnightAuctionApp().render(true);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, STATE_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultState()
  });

  game.settings.register(MODULE_ID, ACTOR_SETTING, {
    name: "Auction Actor",
    hint: "UUID of the actor that holds Midnight Auction items.",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, TIMER_SETTING, {
    name: "Bid Timer Seconds",
    hint: "The countdown length. Each accepted bid resets the timer to this value.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(MODULE_ID, DEFAULT_INCREMENT_SETTING, {
    name: "Default Bid Increment",
    hint: "Default gold increase for items that do not have a custom increment set in the auction screen.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(MODULE_ID, SCENE_IMAGES_SETTING, {
    name: "Scene Images",
    hint: "Optional image paths, one per line: idle, round live, item live, sold. Leave blank to use Foundry icons.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});

Hooks.once("ready", async () => {
  game.socket.on(SOCKET, async (data) => {
    if (data.type === "bid") return processBid(data);
    if (data.type === "state") return renderAuctionApps();
    if (data.type === "notify") {
      if (!data.userId || data.userId === game.user.id) ui.notifications.info(data.message);
      return renderAuctionApps();
    }
    return null;
  });

  await ensureMacro();
});

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  if (!game.user.isGM) return;
  buttons.unshift({
    label: "Auction",
    class: "midnight-auction",
    icon: "fas fa-gavel",
    onclick: () => openAuction()
  });
});

game.modules.get(MODULE_ID).api = {
  open: openAuction,
  createAuctionActor,
  reset: () => setState(defaultState())
};
