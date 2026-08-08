// Qortino loading lines — drop-in replacement
// Tone: warm, playful, proudly offline. Rotate ~3.2s as before.

export const ASSEMBLE_TIPS = [
  // Offline pride
  'No cloud. No servers. Just us and your phone…',
  "Every token stays right here in your pocket…",
  "Working entirely on-device — the internet wasn't invited…",
  'Zero bars? Zero problem…',
  "Your data isn't going anywhere. Literally…",
  'Airplane mode approved ✈️',
  "Somewhere, a data center wonders why it wasn't called…",
  // Searching / RAG
  'Flipping through Qortino’s knowledge…',
  'Sniffing out the right pages…',
  'Dusting off the survival handbook…',
  'Asking the seed-saving chapter if it knows anything…',
  'Matching your question to the best notes…',
  "Checking the handbook so you don't have to…",
  // Model / thinking
  'Thinking with weights, not WiFi…',
  'Warming up my tiny offline brain…',
  'Neurons firing at the speed of your phone…',
  'Squeezing wisdom out of a few gigabytes…',
  'Small model, big heart…',
  'Thinking hard. Well — as hard as 3 billion parameters can…',
  // Qortal flavor
  'Minting an answer — payment accepted in kindness…',
  'This reply is free. A thank-you settles the bill…',
  'Brewing something Tribe-approved…',
  'Decentralized thoughts in progress…',
  'Sovereign computing at work…',
  // Cozy / mascot
  'Scratching my head (gently)…',
  'One moment — good answers, like good bread, need a little rise…',
  'Pouring the thoughts before they get cold…',
  'Almost there. Patience is a survival skill too…',
];

/** Rotating tips while Assembling… in QDN mode (no airplane / offline jokes). */
export const QDN_ASSEMBLE_TIPS = [
  'Knocking on the name registry… anybody home?',
  'Following breadcrumbs across QDN…',
  'Asking peers if they’ve seen that name lately…',
  'Peeking into publishes without waking the whole chain…',
  'Rummaging through Q-Tube / Q-Blog shelves…',
  'Listening for public chat echoes…',
  'Matching avatars to addresses — fashion first…',
  'Polling the node for publish details…',
  'Tracing levels, tags, and tribe footprints…',
  'Hunting media that actually plays (fancy that)…',
  'Combing recent activity like a gentle detective…',
  'Decentralized gossip, but polite…',
  'Weaving on-chain clues into a pocket-sized story…',
  'Almost got the dossier — tying the last ribbon…',
  'QDN is chatting back… slowly, on purpose…',
  'Minting curiosity into a real answer…',
  'Indexing the commons for practical know-how…',
  'Asking QDN if anyone published that skill already…',
];

// One-shot status lines (JS, during send)
export const STATUS_LINES = {
  searchPack: 'Flipping through Qortino’s on-device knowledge…',
  loadFast: 'Waking the Fast model — small, quick, caffeinated…',
  loadMax: 'Waking the Max model — bigger brain, worth the stretch…',
  quickScan: 'Quick skim of Qortino’s knowledge…',
  deepSearch: 'Deep dive into Qortino’s knowledge — snorkel on…',
  fastPath: 'Fast path — short complete answer…',
  maxPath: 'Max path — assembling a complete answer…',
  maxWriting: 'Assembling Max answer — finishing every section…',
  qdnScan: 'Knocking on the QDN name registry…',
  qdnActivity: 'Tracing their on-chain footprints…',
  qdnMedia: 'Pulling a small shelf of their QDN media…',
  qdnVoice: 'Skimming publishes and public chat echoes…',
  qdnCharacter: 'Sketching their character from what they publish…',
  qdnReady: 'QDN notes in hand — weaving the reply…',
  qdnNomination: 'Drafting a convincing nomination from their portfolio…',
  qdnTopic: 'Searching QDN publishes for that how-to…',
  qdnQuick: 'Quick QDN look — recent activity and live publishes…',
  qdnFull: 'Full history scan — paging older txs and publishes (patience)…',
  qdnFullTx: 'Full scan · paging transaction history…',
  qdnFullRes: 'Full scan · indexing QDN resources…',
  qdnFullMedia: 'Full scan · verifying live media on the network…',
  qdnFullSites: 'Full scan · probing APP / WEBSITE roots…',
};

// Live progress (native / C++) — keep placeholders intact
export const PROGRESS_LINES = {
  readPrompt: 'Reading your question — carefully, twice…',
  warmup: 'Warming local weights · {n} / {total} tokens',
  compose: 'Weaving your notes into an answer…',
  writing: 'Writing offline · {n} tokens and counting…',
  ready: 'Ready — made on this phone, for you 🌱',
  finished: 'Done. No cloud was harmed in the making of this reply.',
};
