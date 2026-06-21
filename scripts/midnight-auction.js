const MODULE_ID = "midnight-auction";
const AUCTION_NAME = "Midnight Auction";
const SOCKET = `module.${MODULE_ID}`;
const STATE_SETTING = "state";
const CATALOG_SETTING = "catalog";
const TIMER_SETTING = "timerMode";
const SUDDEN_DEATH_SECONDS_SETTING = "suddenDeathSeconds";
const DEFAULT_INCREMENT_SETTING = "defaultIncrement";
const NPC_BID_INCREMENT_SETTING = "npcBidIncrement";
const NPC_BIDDERS_SETTING = "npcBidders";
const ROUND_COUNT_SETTING = "roundCount";
const STARTING_BID_PERCENT_SETTING = "startingBidPercent";
const SCENE_IMAGES_SETTING = "sceneImages";
const AUCTION_PHOTO_SETTING = "auctionPhoto";
const PREVIEW_ENABLED_SETTING = "previewEnabled";
const PREVIEW_SECONDS_SETTING = "previewSeconds";
const TRANSFER_ITEM_SETTING = "transferItemToWinner";
const WINNER_SOUND_ENABLED_SETTING = "winnerSoundEnabled";
const WINNER_SOUND_SETTING = "winnerSound";
const WINNER_SOUND_VOLUME_SETTING = "winnerSoundVolume";
const AUCTION_START_SOUND_ENABLED_SETTING = "auctionStartSoundEnabled";
const AUCTION_START_SOUND_SETTING = "auctionStartSound";
const AUCTION_START_SOUND_VOLUME_SETTING = "auctionStartSoundVolume";
const AUTO_OPEN_PLAYERS_SETTING = "autoOpenPlayers";
const AUCTION_PROFILES_SETTING = "auctionProfiles";
const ACTIVE_AUCTION_SETTING = "activeAuctionId";
const FLOAT_POSITION_SETTING = "floatingButtonPosition";

function randomId() {
  return foundry.utils.randomID(16);
}

function defaultState() {
  return {
    status: "idle",
    roundId: null,
    itemId: null,
    activeItem: null,
    currentPrice: 0,
    endsAt: null,
    timerStartedAt: null,
    winnerUserId: null,
    winnerActorUuid: null,
    npcBidStreak: {
      itemId: null,
      count: 0,
      bidderId: null
    },
    completedItemIds: [],
    bids: [],
    latestResult: null,
    message: "The auction house is waiting for the next lot."
  };
}

function defaultNpcBidders() {
  return [];
}

function defaultCatalog() {
  return {
    rounds: buildRounds()
  };
}

function getState() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, STATE_SETTING) ?? defaultState());
}

function getCatalog() {
  const catalog = foundry.utils.deepClone(game.settings.get(MODULE_ID, CATALOG_SETTING) ?? {});
  return normalizeCatalog(catalog);
}

function configuredRoundCount() {
  let configured = 4;
  try {
    configured = Number(game.settings.get(MODULE_ID, ROUND_COUNT_SETTING)) || 4;
  } catch (_err) {
    configured = 4;
  }
  const count = configured;
  return Math.max(1, Math.min(10, count));
}

function buildRounds() {
  return Array.from({ length: configuredRoundCount() }, (_value, index) => ({
    id: `round-${index + 1}`,
    number: index + 1,
    title: `Round ${index + 1}`,
    items: []
  }));
}

function normalizeCatalog(catalog) {
  const sourceRounds = Array.isArray(catalog.rounds) ? catalog.rounds : [];
  const rounds = buildRounds();
  for (const round of rounds) {
    const existing = sourceRounds.find((candidate) => Number(candidate.number) === round.number || candidate.id === round.id);
    if (existing) round.items = Array.isArray(existing.items) ? existing.items : [];
  }
  return { rounds };
}

function getNpcBidders() {
  const bidders = foundry.utils.deepClone(game.settings.get(MODULE_ID, NPC_BIDDERS_SETTING) ?? []);
  const normalized = Array.isArray(bidders) ? bidders.slice(0, 10) : [];
  return normalized.filter((bidder) => bidder?.name?.trim()).map((bidder, index) => ({
    id: bidder.id || randomId(),
    name: bidder.name || `NPC Bidder ${index + 1}`,
    img: bidder.img || ""
  }));
}

async function setNpcBidders(bidders, { ping = true } = {}) {
  const normalized = (Array.isArray(bidders) ? bidders : [])
    .filter((bidder) => bidder?.name?.trim())
    .slice(0, 10)
    .map((bidder) => ({
      id: bidder.id || randomId(),
      name: bidder.name.trim(),
      img: bidder.img || ""
    }));
  await game.settings.set(MODULE_ID, NPC_BIDDERS_SETTING, normalized);
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "npc-bidders" });
}

async function setCatalog(catalog, { ping = true } = {}) {
  await game.settings.set(MODULE_ID, CATALOG_SETTING, catalog);
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "catalog" });
}

function getAuctionProfiles() {
  const profiles = foundry.utils.deepClone(game.settings.get(MODULE_ID, AUCTION_PROFILES_SETTING) ?? []);
  return (Array.isArray(profiles) ? profiles : []).slice(0, 3).map((profile, index) => ({
    id: profile.id || randomId(),
    name: profile.name || `Auction ${index + 1}`,
    catalog: normalizeCatalog(profile.catalog ?? {})
  }));
}

async function setAuctionProfiles(profiles, { ping = true } = {}) {
  await game.settings.set(MODULE_ID, AUCTION_PROFILES_SETTING, profiles.slice(0, 3));
  renderAuctionApps();
  if (ping) game.socket.emit(SOCKET, { type: "profiles" });
}

function activeAuctionId() {
  return game.settings.get(MODULE_ID, ACTIVE_AUCTION_SETTING) || "";
}

function activeAuctionName() {
  const id = activeAuctionId();
  return getAuctionProfiles().find((profile) => profile.id === id)?.name || "Unsaved Auction";
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
  const auctionPhoto = game.settings.get(MODULE_ID, AUCTION_PHOTO_SETTING) || values[0] || "";
  return {
    idle: auctionPhoto || "icons/environment/settlement/market-stall.webp",
    round: values[1] || auctionPhoto || "icons/environment/settlement/market-stall.webp",
    preview: values[2] || values[1] || auctionPhoto || "icons/sundries/lights/candle-unlit-grey.webp",
    item: values[2] || values[1] || auctionPhoto || "icons/sundries/lights/candle-unlit-grey.webp",
    sold: values[3] || values[2] || auctionPhoto || "icons/commodities/currency/coins-assorted-mix-gold.webp"
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

function lotSnapshot(item) {
  if (!item) return null;
  const marketPrice = Number(item.marketPrice) || Number(item.startingPrice) || 0;
  return {
    id: item.id,
    itemUuid: item.itemUuid || "",
    name: item.name,
    img: item.img || "icons/svg/item-bag.svg",
    sceneImg: item.sceneImg || "",
    description: item.description || "",
    marketPrice,
    startingPrice: effectiveStartingPrice(item),
    increment: Number(item.increment) || Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 1
  };
}

function firstOpenItem(round, completedItemIds = []) {
  const completed = new Set(completedItemIds ?? []);
  return round?.items.find((item) => !completed.has(item.id)) ?? null;
}

function itemAfter(round, itemId, completedItemIds = []) {
  if (!round) return null;
  const completed = new Set(completedItemIds ?? []);
  completed.add(itemId);
  const index = round.items.findIndex((item) => item.id === itemId);
  const laterItem = round.items.slice(index + 1).find((item) => !completed.has(item.id));
  return laterItem ?? round.items.find((item) => !completed.has(item.id)) ?? null;
}

function nextBidFor(item, state) {
  if (!item) return 0;
  const current = Number(state.currentPrice) || 0;
  const increment = Number(item.increment) || Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 1;
  return state.bids?.length ? current + increment : Math.max(current, effectiveStartingPrice(item));
}

function nextNpcBidFor(item, state) {
  if (!item) return 0;
  const current = Number(state.currentPrice) || 0;
  const increment = Number(game.settings.get(MODULE_ID, NPC_BID_INCREMENT_SETTING)) || 1;
  return state.bids?.length ? current + increment : Math.max(current, effectiveStartingPrice(item));
}

function timerMode() {
  return String(game.settings.get(MODULE_ID, TIMER_SETTING) || "10");
}

function selectedTimerMode() {
  const mode = timerMode();
  return mode === "sudden" ? "10" : mode;
}

function timerSeconds() {
  const mode = timerMode();
  if (mode === "sudden") return Math.max(1, Number(game.settings.get(MODULE_ID, SUDDEN_DEATH_SECONDS_SETTING)) || 10);
  return Number(mode) || 10;
}

function bidResetsTimer() {
  return timerMode() !== "sudden";
}

function previewEnabled() {
  return Boolean(game.settings.get(MODULE_ID, PREVIEW_ENABLED_SETTING));
}

function previewSeconds() {
  return Math.max(1, Number(game.settings.get(MODULE_ID, PREVIEW_SECONDS_SETTING)) || 10);
}

function bidRows(state) {
  return (state.bids ?? []).slice(0, 8);
}

function timerProgress(state, timeLeft) {
  if (!["preview", "item"].includes(state.status) || !state.endsAt || !state.timerStartedAt) return 0;
  const total = Math.max(1, state.endsAt - state.timerStartedAt);
  const remaining = Math.max(0, state.endsAt - Date.now());
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

function timerTone(progress) {
  if (progress > 50) return "green";
  if (progress > 20) return "yellow";
  return "red";
}

function bidderAvatar(name) {
  const hue = [...String(name || "No bids")].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 72%, 46%), hsl(${(hue + 70) % 360}, 72%, 62%))`;
}

function bidSummaryRows(state, item) {
  const bids = bidRows(state);
  const bidRowsWithSummaries = bids.map((bid, index) => {
    const previous = bids[index + 1]?.amount ?? effectiveStartingPrice(item);
    const increase = previous > 0 ? Math.round(((bid.amount - previous) / previous) * 100) : 0;
    return {
      ...bid,
      summary: `${bid.bidderName} made a bid for ${bid.amount} gp${increase > 0 ? `, raising it by ${increase}%` : ""}.`
    };
  });

  if (!state.latestResult) return bidRowsWithSummaries;
  return [
    {
      ...state.latestResult,
      summary: state.latestResult.winnerName
        ? `${state.latestResult.winnerName} won ${state.latestResult.itemName} for ${state.latestResult.amount} gp.`
        : `${state.latestResult.itemName} closed with no bids.`
    },
    ...bidRowsWithSummaries
  ].slice(0, 8);
}

function formatTimerLabel(value) {
  if (value === "--") return value;
  const seconds = Math.max(0, Number(value) || 0);
  return `${seconds}s`;
}

function npcBidderSlots(bidders) {
  return Array.from({ length: 10 }, (_value, index) => {
    const bidder = bidders[index] ?? null;
    return {
      index,
      number: index + 1,
      id: bidder?.id ?? "",
      name: bidder?.name ?? "",
      img: bidder?.img ?? "",
      occupied: Boolean(bidder?.name?.trim())
    };
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character]));
}

function startingBidForValue(value) {
  const percent = Math.max(0, Number(game.settings.get(MODULE_ID, STARTING_BID_PERCENT_SETTING)) || 0);
  return Math.floor((Number(value) || 0) * (percent / 100));
}

function effectiveStartingPrice(item) {
  if (!item) return 0;
  const marketPrice = Number(item.marketPrice) || Number(item.startingPrice) || 0;
  return startingBidForValue(marketPrice);
}

function repriceCatalog(catalog) {
  const nextCatalog = foundry.utils.deepClone(catalog);
  for (const round of nextCatalog.rounds ?? []) {
    round.items = (round.items ?? []).map((item) => {
      const marketPrice = Number(item.marketPrice) || Number(item.startingPrice) || 0;
      return {
        ...item,
        marketPrice,
        startingPrice: startingBidForValue(marketPrice)
      };
    });
  }
  return nextCatalog;
}

function itemMarketPrice(item) {
  return Number(foundry.utils.getProperty(item, "system.price.value")) || 0;
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

function invitePlayersToAuction(message) {
  playAuctionStartSound();
  if (!game.settings.get(MODULE_ID, AUTO_OPEN_PLAYERS_SETTING)) return;
  game.socket.emit(SOCKET, { type: "open-auction", message });
}

async function handleAuctionInvite(message) {
  if (game.user.isGM) return;
  ui.notifications.info(message || "The auction is starting.");
  return openAuction();
}

async function postBidChat(bidderName, amount, itemName) {
  const content = `<p><strong>${bidderName}</strong> bids <strong>${amount} gp</strong> on <em>${itemName}</em>.</p>`;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: AUCTION_NAME }),
    content
  });
}

async function postWinnerChat(winningBid, item, { transferred = false } = {}) {
  if (!winningBid) return null;
  const transferText = transferred ? "<p>The lot has been transferred to the winner.</p>" : "";
  const bidderImg = winningBid.bidderImg ? `<img src="${escapeHtml(winningBid.bidderImg)}" alt="${escapeHtml(winningBid.bidderName)}" width="48" height="48">` : "";
  const itemImg = item.img ? `<img src="${escapeHtml(item.img)}" alt="${escapeHtml(item.name)}" width="48" height="48">` : "";
  const content = `
    <div class="midnight-auction-card">
      <h2>${escapeHtml(winningBid.bidderName)} wins!</h2>
      <p>${bidderImg}${itemImg}</p>
      <p><strong>${escapeHtml(item.name)}</strong></p>
      <p>Winning bid: <strong>${winningBid.amount} gp</strong></p>
      ${transferText}
    </div>
  `;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: AUCTION_NAME }),
    content
  });
}

function playWinnerSound() {
  if (!game.settings.get(MODULE_ID, WINNER_SOUND_ENABLED_SETTING)) return;
  const src = game.settings.get(MODULE_ID, WINNER_SOUND_SETTING);
  if (!src) return;
  const volume = Math.max(0, Math.min(1, Number(game.settings.get(MODULE_ID, WINNER_SOUND_VOLUME_SETTING)) || 0.8));
  AudioHelper.play({ src, volume, autoplay: true, loop: false }, true);
}

function playAuctionStartSound() {
  if (!game.settings.get(MODULE_ID, AUCTION_START_SOUND_ENABLED_SETTING)) return;
  const src = game.settings.get(MODULE_ID, AUCTION_START_SOUND_SETTING);
  if (!src) return;
  const volume = Math.max(0, Math.min(1, Number(game.settings.get(MODULE_ID, AUCTION_START_SOUND_VOLUME_SETTING)) || 0.8));
  AudioHelper.play({ src, volume, autoplay: true, loop: false }, true);
}

async function ensureMacros() {
  if (!game.user.isGM) return;
  const playerMacro = {
    name: "Player Midnight Auction",
    img: "icons/tools/scribal/scroll-blue.webp",
    command: `game.modules.get("${MODULE_ID}").api.open();`
  };
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
    },
    playerMacro
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

  await ensurePlayerMacroCompendium(playerMacro);
}

async function ensurePlayerMacroCompendium(playerMacro) {
  try {
    let pack = game.packs.get("world.midnight-auction-player-macros");
    if (!pack && globalThis.CompendiumCollection?.createCompendium) {
      pack = await globalThis.CompendiumCollection.createCompendium({
        type: "Macro",
        label: "Midnight Auction Player Macros",
        name: "midnight-auction-player-macros",
        package: "world"
      });
    }
    if (!pack) return;
    const index = await pack.getIndex();
    if (index.some((entry) => entry.name === playerMacro.name)) return;
    await Macro.create({
      ...playerMacro,
      type: "script",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    }, { pack: pack.collection });
  } catch (err) {
    console.warn(`${AUCTION_NAME} could not create the player macro compendium.`, err);
  }
}

function addFloatingButton() {
  if (!game.user.isGM) {
    document.getElementById("midnight-auction-float")?.remove();
    return;
  }
  if (document.getElementById("midnight-auction-float")) return;

  const button = document.createElement("button");
  button.id = "midnight-auction-float";
  button.type = "button";
  button.innerHTML = `<i class="fas fa-gavel"></i>`;
  button.title = "Open Midnight Auction builder";
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
    this._showSettings = false;
    this._showBidders = false;
  }

  async getData() {
    const catalog = getCatalog();
    const state = getState();
    const { round, item: catalogActiveItem } = activeLot(catalog, state);
    const activeItem = catalogActiveItem ?? state.activeItem;
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
    const completed = new Set(state.completedItemIds ?? []);
    const npcBidders = getNpcBidders().map((bidder, index) => ({
      ...bidder,
      number: index + 1
    }));
    const mode = timerMode();
    const latestBids = bidSummaryRows(state, activeItem);
    const highestBid = latestBids[0] ?? null;
    const timingActive = ["preview", "item"].includes(state.status);
    const isBidding = state.status === "item";
    const isPreview = state.status === "preview";
    const progress = timerProgress(state, timeLeft);
    const profiles = getAuctionProfiles();
    const currentAuctionId = activeAuctionId();

    return {
      isGM: game.user.isGM,
      title: isBidding ? "Bidding Is Live" : isPreview ? "Lot Preview" : AUCTION_NAME,
      subtitle: state.message,
      sceneImage: activeItem?.sceneImg || images[state.status] || images.idle,
      timerLabel: isPreview ? "Reading Time" : isBidding ? "Seconds Left" : "Timer",
      timeLeft: timingActive ? timeLeft : "--",
      timeDisplay: timingActive ? formatTimerLabel(timeLeft) : "--",
      timerProgress: progress,
      timerTone: timerTone(progress),
      showBidProgress: isBidding,
      urgent: timingActive && timeLeft <= 3,
      item,
      itemDescription: activeItem ? await TextEditor.enrichHTML(activeItem.description || "", { async: true }) : "<p>The velvet curtain has not lifted yet.</p>",
      marketPrice: Number(activeItem?.marketPrice) || 0,
      currentPrice: Number(state.currentPrice) || 0,
      nextBid,
      bidLabel: isPreview ? "Read the lot" : `Bid ${nextBid} gp`,
      nextNpcBid: nextNpcBidFor(activeItem, state),
      gold,
      canBid: Boolean(activeItem && isBidding && goldActor && gold >= nextBid),
      canNpcBid: Boolean(activeItem && isBidding && npcBidders.some((bidder) => bidder.name?.trim())),
      bids: latestBids,
      highestBidder: highestBid
        ? {
          name: highestBid.bidderName,
          amount: highestBid.amount,
          img: highestBid.bidderImg || "",
          initial: highestBid.bidderName.slice(0, 1).toUpperCase(),
          avatarStyle: bidderAvatar(highestBid.bidderName)
        }
        : {
          name: "No bids",
          amount: 0,
          img: "",
          initial: "-",
          avatarStyle: "linear-gradient(135deg, #9a9387, #cbc4b8)"
        },
      npcBidders,
      npcSlots: npcBidderSlots(npcBidders),
      showSettings: this._showSettings,
      showBidders: this._showBidders,
      activeAuctionName: activeAuctionName(),
      auctionProfiles: profiles.map((profile) => ({
        ...profile,
        active: profile.id === currentAuctionId
      })),
      canSaveAuction: profiles.length < 3 || Boolean(currentAuctionId),
      settings: {
        timerMode: mode,
        timerOptions: [
          { value: "5", label: "5 seconds", selected: selectedTimerMode() === "5" },
          { value: "10", label: "10 seconds", selected: selectedTimerMode() === "10" },
          { value: "15", label: "15 seconds", selected: selectedTimerMode() === "15" },
          { value: "30", label: "30 seconds", selected: selectedTimerMode() === "30" }
        ],
        suddenDeath: mode === "sudden",
        suddenDeathSeconds: Number(game.settings.get(MODULE_ID, SUDDEN_DEATH_SECONDS_SETTING)) || 10,
        previewEnabled: previewEnabled(),
        previewSeconds: previewSeconds(),
        auctionPhoto: game.settings.get(MODULE_ID, AUCTION_PHOTO_SETTING) || "",
        transferItemToWinner: Boolean(game.settings.get(MODULE_ID, TRANSFER_ITEM_SETTING)),
        winnerSoundEnabled: Boolean(game.settings.get(MODULE_ID, WINNER_SOUND_ENABLED_SETTING)),
        winnerSound: game.settings.get(MODULE_ID, WINNER_SOUND_SETTING) || "",
        winnerSoundVolume: Number(game.settings.get(MODULE_ID, WINNER_SOUND_VOLUME_SETTING)) || 0.8,
        auctionStartSoundEnabled: Boolean(game.settings.get(MODULE_ID, AUCTION_START_SOUND_ENABLED_SETTING)),
        auctionStartSound: game.settings.get(MODULE_ID, AUCTION_START_SOUND_SETTING) || "",
        auctionStartSoundVolume: Number(game.settings.get(MODULE_ID, AUCTION_START_SOUND_VOLUME_SETTING)) || 0.8,
        autoOpenPlayers: Boolean(game.settings.get(MODULE_ID, AUTO_OPEN_PLAYERS_SETTING)),
        startingBidPercent: Number(game.settings.get(MODULE_ID, STARTING_BID_PERCENT_SETTING)) || 0,
        roundCount: configuredRoundCount(),
        defaultIncrement: Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 10,
        npcBidIncrement: Number(game.settings.get(MODULE_ID, NPC_BID_INCREMENT_SETTING)) || 10
      },
      rounds: catalog.rounds.map((catalogRound) => ({
        ...catalogRound,
        active: state.roundId === catalogRound.id,
        selected: selectedRound?.id === catalogRound.id,
        items: catalogRound.items.map((lot) => ({
          ...lot,
          active: state.itemId === lot.id,
          complete: completed.has(lot.id),
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
            complete: completed.has(lot.id),
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
    html.find("[data-action='toggle-settings']").on("click", () => this._onToggleSettings());
    html.find("[data-action='toggle-bidders']").on("click", () => this._onToggleBidders());
    html.find("[data-action='pick-file']").on("click", (event) => this._onPickFile(event));
    html.find("[data-action='save-auction']").on("click", () => this._onSaveAuction());
    html.find("[data-action='new-auction']").on("click", () => this._onNewAuction());
    html.find("[data-action='load-auction']").on("click", (event) => this._onLoadAuction(event));
    html.find("[data-action='delete-auction']").on("click", (event) => this._onDeleteAuction(event));
    html.find("[data-action='backup-auction']").on("click", () => this._onBackupAuction());
    html.find("[data-action='select-round']").on("click", (event) => this._onSelectRound(event));
    html.find("[data-action='delete-item']").on("click", (event) => this._onDeleteItem(event));
    html.find("[data-action='start-round']").on("click", (event) => this._onStartRound(event));
    html.find("[data-action='end-round']").on("click", (event) => this._onEndRound(event));
    html.find("[data-action='start-item']").on("click", (event) => this._onStartItem(event));
    html.find("[data-action='end-item']").on("click", (event) => this._onEndItem(event));
    html.find("[data-action='npc-bid']").on("click", () => this._onNpcBid());
    html.find("[data-action='bid']").on("click", () => this._onBid());
    html.find("[data-action='edit-npc']").on("click", (event) => this._onEditNpcBidder(event));
    html.find("[data-action='remove-npc']").on("click", (event) => this._onRemoveNpcBidder(event));
    html.find("[data-setting]").on("change", (event) => this._onSettingChange(event));
    html.find(".ma-npc-row, [data-npc-drop]").on("dragover", (event) => event.preventDefault());
    html.find(".ma-npc-row, [data-npc-drop]").on("drop", (event) => this._onNpcDrop(event));
    html.find("[data-round-drop]").on("dragover", (event) => event.preventDefault());
    html.find("[data-round-drop]").on("drop", (event) => this._onRoundDrop(event));
  }

  async _render(...args) {
    const scrollPositions = this._captureScrollPositions();
    await super._render(...args);
    this._restoreScrollPositions(scrollPositions);
    this._startClock();
  }

  _captureScrollPositions() {
    const root = this.element?.[0];
    if (!root) return {};
    return {
      description: root.querySelector(".ma-description")?.scrollTop ?? 0,
      bids: root.querySelector(".ma-bids-card ol")?.scrollTop ?? 0
    };
  }

  _restoreScrollPositions(scrollPositions) {
    const root = this.element?.[0];
    if (!root) return;
    const description = root.querySelector(".ma-description");
    const bids = root.querySelector(".ma-bids-card ol");
    if (description) description.scrollTop = scrollPositions.description ?? 0;
    if (bids) bids.scrollTop = scrollPositions.bids ?? 0;
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
      if (["preview", "item"].includes(state.status) && state.endsAt && Date.now() >= state.endsAt && game.user.isGM && isPrimaryActiveGM() && !this._ending) {
        if (state.status === "preview") this._beginLotBidding(state);
        else this._onEndItem({ currentTarget: { dataset: { itemId: state.itemId } } });
      } else if (this._hasFocusedField()) {
        return;
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

  _onToggleSettings() {
    if (!game.user.isGM) return;
    this._showSettings = !this._showSettings;
    this.render(false);
  }

  _onToggleBidders() {
    if (!game.user.isGM) return;
    this._showBidders = !this._showBidders;
    this.render(false);
  }

  _hasFocusedField() {
    const element = document.activeElement;
    return Boolean(element?.closest?.(".midnight-auction") && element.matches("input, select, textarea"));
  }

  _onPickFile(event) {
    if (!game.user.isGM) return;
    const setting = event.currentTarget.dataset.setting;
    const type = event.currentTarget.dataset.fileType || "any";
    new FilePicker({
      type,
      current: game.settings.get(MODULE_ID, setting) || "",
      callback: async (path) => {
        await game.settings.set(MODULE_ID, setting, path);
        renderAuctionApps();
        game.socket.emit(SOCKET, { type: "settings" });
      }
    }).browse();
  }

  async _onSaveAuction() {
    if (!game.user.isGM) return;
    const profiles = getAuctionProfiles();
    const currentId = activeAuctionId();
    const existing = profiles.find((profile) => profile.id === currentId);
    if (!existing && profiles.length >= 3) return ui.notifications.warn("Midnight Auction can keep three saved auctions at once.");

    const currentName = existing?.name || activeAuctionName();
    new Dialog({
      title: "Save Auction",
      content: `<form><div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(currentName)}"></div></form>`,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Save",
          callback: async (html) => {
            const name = html.find("[name='name']").val()?.trim() || "Midnight Auction";
            const catalog = getCatalog();
            const nextProfiles = getAuctionProfiles();
            const index = nextProfiles.findIndex((profile) => profile.id === currentId);
            const profile = {
              id: currentId || randomId(),
              name,
              catalog
            };
            if (index >= 0) nextProfiles[index] = profile;
            else nextProfiles.push(profile);
            await setAuctionProfiles(nextProfiles);
            await game.settings.set(MODULE_ID, ACTIVE_AUCTION_SETTING, profile.id);
            renderAuctionApps();
            game.socket.emit(SOCKET, { type: "profiles" });
            ui.notifications.info(`${name} saved.`);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "save"
    }).render(true);
  }

  async _onNewAuction() {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, ACTIVE_AUCTION_SETTING, "");
    await setCatalog(defaultCatalog());
    await setState({ ...defaultState(), message: "New auction started. Save it when the rounds are ready." });
    this._selectedRoundId = null;
    ui.notifications.info("New auction started.");
  }

  async _onLoadAuction(event) {
    if (!game.user.isGM) return;
    const profileId = event.currentTarget.dataset.profileId;
    const profile = getAuctionProfiles().find((candidate) => candidate.id === profileId);
    if (!profile) return;
    await setCatalog(profile.catalog);
    await game.settings.set(MODULE_ID, ACTIVE_AUCTION_SETTING, profile.id);
    await setState({ ...defaultState(), message: `${profile.name} is loaded.` });
    ui.notifications.info(`${profile.name} loaded.`);
  }

  async _onDeleteAuction(event) {
    if (!game.user.isGM) return;
    const profileId = event.currentTarget.dataset.profileId;
    const profiles = getAuctionProfiles().filter((profile) => profile.id !== profileId);
    await setAuctionProfiles(profiles);
    if (activeAuctionId() === profileId) {
      await game.settings.set(MODULE_ID, ACTIVE_AUCTION_SETTING, "");
      renderAuctionApps();
      game.socket.emit(SOCKET, { type: "profiles" });
    }
  }

  async _onBackupAuction() {
    if (!game.user.isGM) return;
    const name = activeAuctionName();
    const payload = {
      name,
      backedUpAt: new Date().toISOString(),
      catalog: getCatalog()
    };
    try {
      let pack = game.packs.get("world.midnight-auction-backups");
      if (!pack && globalThis.CompendiumCollection?.createCompendium) {
        pack = await globalThis.CompendiumCollection.createCompendium({
          type: "JournalEntry",
          label: "Midnight Auction Backups",
          name: "midnight-auction-backups",
          package: "world"
        });
      }
      if (!pack) throw new Error("Backup compendium is not available.");

      const entry = await JournalEntry.create({
        name: `${name} Backup`,
        pages: [{
          name: "Auction Data",
          type: "text",
          text: {
            format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
            content: `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`
          }
        }]
      }, { pack: pack.collection });
      ui.notifications.info(`Backed up ${entry.name} to Midnight Auction Backups.`);
    } catch (err) {
      console.error(err);
      ui.notifications.warn("Could not create the compendium backup. Check the console for details.");
    }
  }

  async _onAddItem(roundId, itemDocument = null) {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const round = findRound(catalog, roundId);
    if (!round) return;

    const itemData = itemDocument ? this._lotFromItem(itemDocument) : null;
    round.items.push({
      id: randomId(),
      itemUuid: itemData?.itemUuid || "",
      name: itemData?.name || "New Auction Lot",
      img: itemData?.img || "icons/svg/item-bag.svg",
      sceneImg: "",
      description: itemData?.description || "Describe this lot for your bidders.",
      marketPrice: itemData?.marketPrice ?? 0,
      startingPrice: itemData?.startingPrice ?? 10,
      increment: Number(game.settings.get(MODULE_ID, DEFAULT_INCREMENT_SETTING)) || 10
    });
    await setCatalog(catalog);
  }

  _lotFromItem(item) {
    const value = itemMarketPrice(item);
    return {
      name: item.name,
      itemUuid: item.uuid,
      img: item.img || "icons/svg/item-bag.svg",
      description: foundry.utils.getProperty(item, "system.description.value") || "",
      marketPrice: value,
      startingPrice: startingBidForValue(value)
    };
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

  async _onRoundDrop(event) {
    if (!game.user.isGM) return;
    event.preventDefault();
    const roundId = event.currentTarget.dataset.roundDrop;
    let data = null;
    try {
      data = JSON.parse(event.originalEvent?.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("text/plain") || "{}");
    } catch (_err) {
      return;
    }

    const document = data.uuid ? await fromUuid(data.uuid) : null;
    if (!document || document.documentName !== "Item") {
      ui.notifications.warn("Drop an Item onto the round to add it as an auction lot.");
      return;
    }

    await this._onAddItem(roundId, document);
    this._selectedRoundId = roundId;
  }

  async _onStartRound(event) {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const round = findRound(catalog, event.currentTarget.dataset.roundId);
    if (!round) return;
    this._selectedRoundId = round.id;

    const firstItem = firstOpenItem(round, []);
    if (firstItem) {
      await this._startLot(round, firstItem, {
        completedItemIds: [],
        message: `${round.title || `Round ${round.number}`} begins. ${firstItem.name} is on the block.`
      });
      notifyAll(`${round.title || `Round ${round.number}`} begins with ${firstItem.name}.`);
      invitePlayersToAuction(`${round.title || `Round ${round.number}`} has begun.`);
      return;
    }

    await setState({
      ...getState(),
      status: "round",
      roundId: round.id,
      itemId: null,
      activeItem: null,
      currentPrice: 0,
      endsAt: null,
      timerStartedAt: null,
      winnerUserId: null,
      winnerActorUuid: null,
      completedItemIds: [],
      bids: [],
      message: `${round.title || `Round ${round.number}`} has no lots yet.`
    });
    notifyAll(`${round.title || `Round ${round.number}`} has no lots yet.`);
    invitePlayersToAuction(`${round.title || `Round ${round.number}`} has begun.`);
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
      activeItem: null,
      currentPrice: 0,
      endsAt: null,
      timerStartedAt: null,
      bids: [],
      completedItemIds: [],
      message: `${round.title || `Round ${round.number}`} has ended.`
    });
    notifyAll(`${round.title || `Round ${round.number}`} has ended.`);
  }

  async _onStartItem(event) {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const { round, item } = findLot(catalog, event.currentTarget.dataset.itemId);
    if (!round || !item) return;
    const state = getState();
    const completedItemIds = (state.completedItemIds ?? []).filter((id) => id !== item.id);
    await this._startLot(round, item, { completedItemIds });
    notifyAll(`${item.name} is live at the Midnight Auction.`);
  }

  async _startLot(round, item, { completedItemIds = getState().completedItemIds ?? [], latestResult = getState().latestResult ?? null, message = null } = {}) {
    const startingPrice = effectiveStartingPrice(item);
    const now = Date.now();
    const usePreview = previewEnabled();
    const lotMessage = message && !usePreview ? message : usePreview
      ? `${item.name} is being presented. Bidding opens shortly.`
      : `${item.name} is on the block. Opening bid: ${startingPrice} gp.`;
    await setState({
      status: usePreview ? "preview" : "item",
      roundId: round.id,
      itemId: item.id,
      activeItem: lotSnapshot(item),
      currentPrice: startingPrice,
      endsAt: now + (usePreview ? previewSeconds() : timerSeconds()) * 1000,
      timerStartedAt: now,
      winnerUserId: null,
      winnerActorUuid: null,
      npcBidStreak: {
        itemId: item.id,
        count: 0,
        bidderId: null
      },
      completedItemIds,
      bids: [],
      latestResult,
      message: lotMessage
    });
  }

  async _beginLotBidding(state = getState()) {
    if (!game.user.isGM || !isPrimaryActiveGM()) return;
    this._ending = true;
    try {
      const catalog = getCatalog();
      const { item: catalogItem } = activeLot(catalog, state);
      const item = catalogItem ?? state.activeItem;
      if (!item || state.status !== "preview") return;

      const now = Date.now();
      const startingPrice = effectiveStartingPrice(item) || Number(state.currentPrice) || 0;
      await setState({
        ...state,
        status: "item",
        activeItem: lotSnapshot(item),
        currentPrice: startingPrice,
        endsAt: now + timerSeconds() * 1000,
        timerStartedAt: now,
        message: `${item.name} is on the block. Opening bid: ${startingPrice} gp.`
      });
      notifyAll(`Bidding is open for ${item.name}.`);
    } finally {
      this._ending = false;
    }
  }

  async _onEndItem(event) {
    if (!game.user.isGM || !isPrimaryActiveGM()) return;
    this._ending = true;
    try {
      const catalog = getCatalog();
      const state = getState();
      const itemId = event.currentTarget.dataset.itemId || state.itemId;
      const { round, item } = findLot(catalog, itemId);
      if (!round || !item || state.itemId !== itemId) return;

      const winningBid = state.bids?.[0];
      const transferred = winningBid ? await this._settleWinningBid(winningBid, item) : false;
      const completedItemIds = [...new Set([...(state.completedItemIds ?? []), item.id])];
      const nextItem = itemAfter(round, item.id, state.completedItemIds ?? []);

      const message = winningBid
        ? `${winningBid.bidderName} wins ${item.name} for ${winningBid.amount} gp.`
        : `${item.name} received no bids.`;
      const latestResult = {
        itemName: item.name,
        winnerName: winningBid?.bidderName || "",
        bidderName: winningBid?.bidderName || "No bids",
        bidderImg: winningBid?.bidderImg || "",
        amount: winningBid?.amount || 0,
        isResult: true,
        time: Date.now()
      };
      if (winningBid) {
        await postWinnerChat(winningBid, item, { transferred });
        playWinnerSound();
      }
      notifyAll(message);

      if (nextItem) {
        await this._startLot(round, nextItem, {
          completedItemIds,
          latestResult,
          message: `${message} Next lot: ${nextItem.name}.`
        });
        notifyAll(`${nextItem.name} is now on the block.`);
        return;
      }

      await setState({
        ...state,
        status: "sold",
        itemId: null,
        activeItem: null,
        currentPrice: 0,
        endsAt: null,
        timerStartedAt: null,
        completedItemIds,
        latestResult,
        message: `${message} ${round.title || `Round ${round.number}`} is complete.`
      });
      notifyAll(`${round.title || `Round ${round.number}`} is complete.`);
    } finally {
      this._ending = false;
    }
  }

  async _settleWinningBid(winningBid, item) {
    if (!winningBid.actorUuid) return false;
    const winnerActor = await fromUuid(winningBid.actorUuid);
    if (!winnerActor) return false;
    const gold = getCurrencyGp(winnerActor);
    await setCurrencyGp(winnerActor, gold - winningBid.amount);
    if (!game.settings.get(MODULE_ID, TRANSFER_ITEM_SETTING)) return false;

    const sourceItem = item.itemUuid ? await fromUuid(item.itemUuid) : null;
    const itemData = sourceItem
      ? sourceItem.toObject()
      : {
        name: item.name,
        type: "loot",
        img: item.img || "icons/svg/item-bag.svg",
        system: {
          description: {
            value: item.description || ""
          }
        }
      };
    delete itemData._id;
    await winnerActor.createEmbeddedDocuments("Item", [itemData]);
    return true;
  }

  async _onNpcBid() {
    if (!game.user.isGM) return;
    const catalog = getCatalog();
    const state = getState();
    const { item: catalogItem } = activeLot(catalog, state);
    const item = catalogItem ?? state.activeItem;
    if (!item || state.status !== "item") return ui.notifications.warn("Start a lot before placing an NPC bid.");

    const bidders = getNpcBidders().filter((bidder) => bidder.name?.trim());
    if (!bidders.length) return ui.notifications.warn("Add at least one NPC bidder first.");

    const streak = state.npcBidStreak?.itemId === state.itemId
      ? foundry.utils.deepClone(state.npcBidStreak)
      : { itemId: state.itemId, count: 0, bidderId: null };
    const amount = nextNpcBidFor(item, state);
    const now = Date.now();
    const focused = bidders.find((bidder) => bidder.id === streak.bidderId);
    const bidder = streak.count >= 3 && focused
      ? focused
      : bidders[Math.floor(Math.random() * bidders.length)];
    const nextCount = streak.count + 1;
    const focusId = nextCount >= 3 ? bidder.id : streak.bidderId;
    const bid = {
      bidderName: bidder.name,
      bidderImg: bidder.img || "",
      npcBidderId: bidder.id,
      amount,
      time: now,
      isNpc: true
    };

    const nextState = {
      ...state,
      currentPrice: amount,
      endsAt: bidResetsTimer() ? now + timerSeconds() * 1000 : state.endsAt,
      timerStartedAt: bidResetsTimer() ? now : state.timerStartedAt,
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

  async _onEditNpcBidder(event) {
    if (!game.user.isGM) return;
    const index = Number(event.currentTarget.dataset.npcIndex);
    const bidders = getNpcBidders();
    if (!bidders[index]) return;

    const currentName = bidders[index].name;
    new Dialog({
      title: "Edit NPC Bidder",
      content: `<form><div class="form-group"><label>Name</label><input type="text" name="name" value="${escapeHtml(currentName)}"></div></form>`,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Save",
          callback: async (html) => {
            const name = html.find("[name='name']").val()?.trim();
            if (!name) return;
            bidders[index].name = name;
            await setNpcBidders(bidders);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "save"
    }).render(true);
  }

  async _onRemoveNpcBidder(event) {
    if (!game.user.isGM) return;
    const index = Number(event.currentTarget.dataset.npcIndex);
    const bidders = getNpcBidders();
    if (!bidders[index]) return;
    bidders.splice(index, 1);
    await setNpcBidders(bidders);
  }

  async _onSettingChange(event) {
    if (!game.user.isGM) return;
    const setting = event.currentTarget.dataset.setting;
    if (setting === "suddenDeath") {
      await game.settings.set(MODULE_ID, TIMER_SETTING, event.currentTarget.checked ? "sudden" : selectedTimerMode());
      renderAuctionApps();
      game.socket.emit(SOCKET, { type: "settings" });
      return;
    }

    const numericSettings = new Set([
      SUDDEN_DEATH_SECONDS_SETTING,
      STARTING_BID_PERCENT_SETTING,
      ROUND_COUNT_SETTING,
      DEFAULT_INCREMENT_SETTING,
      NPC_BID_INCREMENT_SETTING,
      PREVIEW_SECONDS_SETTING,
      WINNER_SOUND_VOLUME_SETTING,
      AUCTION_START_SOUND_VOLUME_SETTING
    ]);
    const booleanSettings = new Set([
      PREVIEW_ENABLED_SETTING,
      TRANSFER_ITEM_SETTING,
      WINNER_SOUND_ENABLED_SETTING,
      AUCTION_START_SOUND_ENABLED_SETTING,
      AUTO_OPEN_PLAYERS_SETTING
    ]);
    let value = event.currentTarget.value;
    if (booleanSettings.has(setting)) value = event.currentTarget.checked;
    if (numericSettings.has(setting)) value = Number(value) || 0;

    if (setting === ROUND_COUNT_SETTING) value = Math.max(1, Math.min(10, value));
    if (setting === SUDDEN_DEATH_SECONDS_SETTING) value = Math.max(1, value);
    if (setting === PREVIEW_SECONDS_SETTING) value = Math.max(1, value);
    if (setting === STARTING_BID_PERCENT_SETTING) value = Math.max(0, Math.min(1000, value));
    if ([WINNER_SOUND_VOLUME_SETTING, AUCTION_START_SOUND_VOLUME_SETTING].includes(setting)) value = Math.max(0, Math.min(1, value));
    if ([DEFAULT_INCREMENT_SETTING, NPC_BID_INCREMENT_SETTING].includes(setting)) value = Math.max(1, value);

    await game.settings.set(MODULE_ID, setting, value);
    if (setting === STARTING_BID_PERCENT_SETTING) await setCatalog(repriceCatalog(getCatalog()), { ping: false });
    if (setting === ROUND_COUNT_SETTING) this._selectedRoundId = null;
    renderAuctionApps();
    game.socket.emit(SOCKET, { type: "settings" });
  }

  async _onNpcDrop(event) {
    if (!game.user.isGM) return;
    event.preventDefault();
    const bidders = getNpcBidders();
    let index = Number(event.currentTarget.dataset.npcIndex);
    if (!Number.isInteger(index)) index = Math.min(bidders.length, 9);

    let data = null;
    try {
      data = JSON.parse(event.originalEvent?.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("text/plain") || "{}");
    } catch (_err) {
      return;
    }

    const actor = data.uuid ? await fromUuid(data.uuid) : null;
    if (!actor) return;
    if (index < 0 || index > 9) return;
    if (index > bidders.length) index = bidders.length;
    bidders[index] = {
      id: bidders[index]?.id || randomId(),
      name: actor.name,
      img: foundry.utils.getProperty(actor, "texture.src") || actor.img || actor.actor?.img || ""
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
  const { item: catalogItem } = activeLot(catalog, state);
  const item = catalogItem ?? state.activeItem;
  if (!bidder || !bidderActor || !item || state.status !== "item") return;

  const amount = nextBidFor(item, state);
  if (getCurrencyGp(bidderActor) < amount) {
    game.socket.emit(SOCKET, { type: "notify", userId: data.userId, message: `Not enough gold to bid ${amount} gp.` });
    return;
  }

  const now = Date.now();
  const bidderName = bidderActor.name || bidder.name;
  const bid = {
    bidderName,
    bidderImg: bidderActor.img || "",
    userId: bidder.id,
    actorUuid: bidderActor.uuid,
    amount,
    time: now
  };

  const nextState = {
    ...state,
    currentPrice: amount,
    endsAt: bidResetsTimer() ? now + timerSeconds() * 1000 : state.endsAt,
    timerStartedAt: bidResetsTimer() ? now : state.timerStartedAt,
    winnerUserId: bidder.id,
    winnerActorUuid: bidderActor.uuid,
    bids: [bid, ...(state.bids ?? [])].slice(0, 20),
    message: `${bidderName} bids ${amount} gp. Going once...`
  };
  await setState(nextState);
  await postBidChat(bidderName, amount, item.name);
  notifyAll(`${bidderName} bids ${amount} gp on ${item.name}.`);
}

function currentAuctionImages() {
  const catalog = getCatalog();
  const state = getState();
  const { item: catalogItem } = activeLot(catalog, state);
  const item = catalogItem ?? state.activeItem;
  const images = sceneImages();
  return [
    item?.sceneImg || images[state.status] || images.idle,
    item?.img || "icons/svg/item-bag.svg"
  ].filter(Boolean);
}

function showAuctionLoading() {
  const existing = document.getElementById("midnight-auction-loading");
  if (existing) return existing;

  const loader = document.createElement("div");
  loader.id = "midnight-auction-loading";
  loader.innerHTML = `
    <div class="ma-loading-box">
      <strong>Midnight Auction</strong>
      <span>Loading artwork...</span>
      <div class="ma-loading-bar"><i style="width: 12%"></i></div>
    </div>
  `;
  document.body.appendChild(loader);
  return loader;
}

function setAuctionLoadingProgress(loader, loaded, total) {
  const bar = loader?.querySelector(".ma-loading-bar i");
  if (!bar) return;
  const percent = total ? Math.max(12, Math.round((loaded / total) * 100)) : 100;
  bar.style.width = `${percent}%`;
}

function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve();
    const image = new Image();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = window.setTimeout(done, 2500);
    image.onload = () => {
      window.clearTimeout(timeout);
      done();
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      done();
    };
    image.src = src;
  });
}

async function preloadAuctionImages() {
  const loader = showAuctionLoading();
  const sources = [...new Set(currentAuctionImages())];
  let loaded = 0;
  setAuctionLoadingProgress(loader, loaded, sources.length);

  for (const source of sources) {
    await preloadImage(source);
    loaded += 1;
    setAuctionLoadingProgress(loader, loaded, sources.length);
  }

  window.setTimeout(() => loader?.remove(), 120);
}

async function openAuction() {
  const existing = Object.values(ui.windows).find((app) => app instanceof MidnightAuctionApp);
  if (existing) return existing.render(true);
  await preloadAuctionImages();
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
    hint: "How long each accepted bid resets the timer. Sudden Death uses its own timer and bids do not reset it.",
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

  game.settings.register(MODULE_ID, SUDDEN_DEATH_SECONDS_SETTING, {
    name: "Sudden Death Seconds",
    hint: "How long a sudden-death lot lasts. Bids do not reset this timer.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(MODULE_ID, PREVIEW_ENABLED_SETTING, {
    name: "Show Lot Preview",
    hint: "Show the item description for a set time before bidding begins.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, PREVIEW_SECONDS_SETTING, {
    name: "Lot Preview Seconds",
    hint: "How long players can read a lot before the bidding countdown begins.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register(MODULE_ID, STARTING_BID_PERCENT_SETTING, {
    name: "Starting Bid Percent",
    hint: "Opening bid as a percentage of item value, rounded down when the item is dropped into a round.",
    scope: "world",
    config: true,
    type: Number,
    default: 100
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

  game.settings.register(MODULE_ID, TRANSFER_ITEM_SETTING, {
    name: "Transfer Item to Winner",
    hint: "When a player wins, copy the auctioned item to their assigned character.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, WINNER_SOUND_ENABLED_SETTING, {
    name: "Play Winner Sound",
    hint: "Play a table-wide sound when a lot has a winner.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, WINNER_SOUND_SETTING, {
    name: "Winner Sound",
    hint: "Audio path to play when a lot is won.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, WINNER_SOUND_VOLUME_SETTING, {
    name: "Winner Sound Volume",
    hint: "Volume for the winner sound, from 0 to 1.",
    scope: "world",
    config: true,
    type: Number,
    default: 0.8
  });

  game.settings.register(MODULE_ID, AUCTION_START_SOUND_ENABLED_SETTING, {
    name: "Play Auction Start Sound",
    hint: "Play a table-wide sound when a round starts.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, AUCTION_START_SOUND_SETTING, {
    name: "Auction Start Sound",
    hint: "Audio path to play when a round starts.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, AUCTION_START_SOUND_VOLUME_SETTING, {
    name: "Auction Start Sound Volume",
    hint: "Volume for the round-start sound, from 0 to 1.",
    scope: "world",
    config: true,
    type: Number,
    default: 0.8
  });

  game.settings.register(MODULE_ID, AUTO_OPEN_PLAYERS_SETTING, {
    name: "Open Players on Round Start",
    hint: "When a round starts, automatically open Midnight Auction for players.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, AUCTION_PROFILES_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: []
  });

  game.settings.register(MODULE_ID, ACTIVE_AUCTION_SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, ROUND_COUNT_SETTING, {
    name: "Auction Rounds",
    hint: "How many fixed round tabs the GM sees, from 1 to 10.",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      1: "1 round",
      2: "2 rounds",
      3: "3 rounds",
      4: "4 rounds",
      5: "5 rounds",
      6: "6 rounds",
      7: "7 rounds",
      8: "8 rounds",
      9: "9 rounds",
      10: "10 rounds"
    },
    default: 4,
    onChange: () => renderAuctionApps()
  });

  game.settings.register(MODULE_ID, SCENE_IMAGES_SETTING, {
    name: "Scene Images",
    hint: "Optional image paths, one per line: idle, round live, item live, sold.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, AUCTION_PHOTO_SETTING, {
    name: "Auction Photo Image",
    hint: "Image path for the main auction photo when no lot-specific scene image is set.",
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
    if (data.type === "open-auction") return handleAuctionInvite(data.message);
    if (["state", "catalog", "npc-bidders", "settings", "profiles"].includes(data.type)) return renderAuctionApps();
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
