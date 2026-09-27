# Scanning (Phase 2 — not built yet)

Phase 1 is local pass-and-play only. No scanning libraries here yet.

Per `docs/V_COLA_DESIGN.md` §2, Phase 2 will add QR / barcode (ZXing-js),
typed-code input, and image classifier (TensorFlow.js) behind one shared
"scan result → unlock flavor" interface. Do not add those dependencies
until Phase 1 is complete and working.
