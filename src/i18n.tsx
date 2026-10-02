import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'ar';

export interface Translations {
  appTitle: string;
  appSubtitle: string;
  tabPlay: string;
  tabDeck: string;
  // Arena
  arenaTitle: string;
  arenaSubtitle: string;
  playerProfiles: string;
  playerProfilesNote: string;
  player1Name: string;
  player2Name: string;
  // Modes
  quickPlayTitle: string;
  quickPlayBadge: string;
  quickPlayDesc: string;
  quickPlayBtn: string;
  rankedNote: string;
  exitMatch: string;
  // Lookaway
  passTo: string;
  lookAway: string;
  showCards: string;
  imPlayer: string;
  // In-turn
  turnBanner: string;
  roundOf: string;
  of3: string;
  tapToPlaceHint: string;
  tapZoneToPlace: string;
  placeAtLeast1: string;
  lockIn: string;
  cardsPlaced: string;
  yourHand: string;
  cardsAvailable: string;
  cardsHidden: string;
  recall: string;
  // Placing board (whole sentences, {name}/{placed} interpolated via fmt)
  turnTitle: string;
  oppStrip: string;
  lockInCount: string;
  needOne: string;
  onlyTwo: string;
  roundN: string;
  takeBack: string;
  oppWaiting: string;
  yourTurnHint: string;
  // Zones
  zoneCoolRule: string;
  zonePartyRule: string;
  zoneEnergyRule: string;
  // Reveal & Result on board
  roundRevealed: string;
  scoresAtEnd: string;
  nextRound: string;
  wonMajority: string;
  allTied: string;
  winsTheMatch: string;
  matchDrawn: string;
  rematch: string;
  returnToMenu: string;
  // Title screen + rails + rotate gate
  mainMenu: string;
  railStandings: string;
  railLastRound: string;
  railRules: string;
  noHistory: string;
  rotateTitle: string;
  rotateDesc: string;
  // Effect resolution sequence (whole sentences via fmt)
  resSkip: string;
  resTapFaster: string;
  resCool: string;
  resCoolNone: string;
  resEmpty: string;
  resParty: string;
  resPartyNone: string;
  resEnergy: string;
  resEnergyNone: string;
  resTakesZone: string;
  resTiedZone: string;
  resReplayHint: string;
  // Deck
  deckTitle: string;
  deckFull: string;
  deckUniqueOnly: string;
  clearDeck: string;
  resetTo0: string;
  noCansTitle: string;
  noCansDesc: string;
  flavorsToUnlock: string;
  tapOwnedToAdd: string;
  inDeck: string;
  starterPackBtn: string;
  comingPhase2: string;
  mute: string;
  unmute: string;
  // Combo legend (group colors + what each group's combo does)
  comboLegendTitle: string;
  comboGroupCola: string;
  comboGroupCitrus: string;
  comboGroupIngredient: string;
  comboGroupBerry: string;
  comboGroupSolo: string;
  cardEffects: Record<string, string>;
  helpClose: string;
  helpMatchTitle: string;
  helpMatchBody: string;
  helpZonesTitle: string;
  helpCombosTitle: string;
  helpCardsTitle: string;
  helpBoardTitle: string;
  helpPower: string;
  helpProgress: string;
  helpChips: string;
  helpCancelled: string;
  helpColors: string;
  helpTags: string;
  tagApple: string;
  tagMalt: string;
  tagPineapple: string;
  // Flavors map
  flavors: Record<string, string>;
}

/**
 * Tiny {name} interpolator for whole-sentence strings.
 * Keeps each localized sentence grammatically whole — no possessive fragments.
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/** Build group explanations from each member card's single effect string. */
export function comboDescription(t: Translations, group: 'cola' | 'citrus' | 'ingredient' | 'berry' | 'solo'): string {
  const members: Record<typeof group, readonly string[]> = {
    cola: ['v-cola'],
    citrus: ['lemon-mint'],
    ingredient: ['v7-apple-malt'],
    berry: ['blueberry'],
    solo: ['pina-colada', 'cream-soda'],
  };
  return [...new Set(members[group].map((id) => t.cardEffects[id]).filter(Boolean))].join(' ');
}

export const TRANSLATIONS: Record<Language, Translations> = {
  en: {
    appTitle: 'V Cola: Collect & Clash',
    appSubtitle: 'From Egypt to the World • 1v1 Tactical Battle',
    tabPlay: 'Play',
    tabDeck: 'Deck',
    // Arena
    arenaTitle: 'Battle Arena',
    arenaSubtitle: '1v1 Tactical Showdown — Control 2 of 3 Zones',
    playerProfiles: 'Player Profiles (Local Pass & Play)',
    playerProfilesNote:
      'Enter player names for pass-and-play. Device is handed over between turns.',
    player1Name: 'Player 1 Name',
    player2Name: 'Player 2 Name',
    // Modes
    quickPlayTitle: 'Quick Play',
    quickPlayBadge: 'Casual • Single Match',
    quickPlayDesc:
      'Instant showdown with 6 unique cans dealt to each player. Relaxed 3-round battle (~4 min).',
    quickPlayBtn: 'Play Quick Match',
    rankedNote:
      'Ranked is reserved for two-phone/online mode. Use Quick Play for 1-device pass-and-play.',
    exitMatch: 'Exit Match',
    // Lookaway
    passTo: 'Pass the phone to',
    lookAway: 'look away! Secret placement phase for',
    showCards: 'Reveal My Hand',
    imPlayer: "I'm",
    // In-turn
    turnBanner: "'s Turn",
    roundOf: 'Round',
    of3: 'of 3',
    tapToPlaceHint: 'Tap a card then tap a zone, or drag directly',
    tapZoneToPlace: 'Tap a zone to place the selected can',
    placeAtLeast1: 'Deploy at least 1 card (0/2 placed)',
    lockIn: 'Lock In Placement',
    cardsPlaced: 'placed',
    yourHand: 'Your Hand',
    cardsAvailable: 'cards available',
    cardsHidden: "'s hidden cards in play:",
    recall: 'Take back',
    turnTitle: '{name} — place 1 or 2 cans',
    oppStrip: '{name} • waiting for their turn',
    lockInCount: 'Lock in ({placed}/2)',
    needOne: 'Place at least 1 can to lock in',
    onlyTwo: 'Only 2 cans per round — tap a placed can to take it back',
    roundN: 'Round {n} of 3',
    takeBack: 'Take back {name}',
    oppWaiting: 'waiting for their turn',
    yourTurnHint: 'place 1 or 2 cans',
    // Zones
    zoneCoolRule: 'Lowest Power +1',
    zonePartyRule: 'Most cards +1',
    zoneEnergyRule: 'Fewer cards +1 each',
    // Reveal & Result on board
    roundRevealed: 'Round Revealed!',
    scoresAtEnd: 'Zone bonuses are calculated after Round 3',
    nextRound: 'Next Round (Round',
    wonMajority: '{name} won the majority of zones!',
    allTied: 'Every zone was tied!',
    winsTheMatch: 'Wins the Match!',
    matchDrawn: 'Match Drawn!',
    rematch: 'Rematch',
    returnToMenu: 'Back to Arena Menu',
    // Title screen + rails + rotate gate
    mainMenu: 'Main Menu',
    railStandings: 'Standings',
    railLastRound: 'Last round',
    railRules: 'Zone rules',
    noHistory: 'No rounds yet',
    rotateTitle: 'Rotate your device',
    rotateDesc: 'V Cola: Collect & Clash plays in landscape.',
    // Effect resolution sequence (whole sentences via fmt)
    resSkip: 'Skip',
    resTapFaster: 'Tap to speed up',
    resCool: 'STAY FROSTY: {name}\u2019s {power} is the lone lowest (+1)',
    resCoolNone: 'STAY FROSTY: no bonus — tied lowest',
    resEmpty: 'No bonus: empty zone',
    resParty: 'PARTY: {name} has more cans here ({a} vs {b}), +1 to the total',
    resPartyNone: 'PARTY: no bonus — equal cans',
    resEnergy: 'ENERGY: {name} has fewer cans here ({a} vs {b}), +1 on each of their cans',
    resEnergyNone: 'ENERGY: no bonus — equal cans',
    resTakesZone: '{name} takes {zone}',
    resTiedZone: 'Tied zone',
    resReplayHint: 'Tap a zone to replay',
    // Deck
    deckTitle: 'Battle Deck',
    deckFull: 'Deck full (6 cards) — tap a slot to remove one first.',
    deckUniqueOnly: 'Unique flavors only — this flavor is already in your deck!',
    clearDeck: 'Clear Deck',
    resetTo0: 'Reset to 0 cans',
    noCansTitle: 'No Cans in Collection',
    noCansDesc: 'Your collection currently has 0 cans.',
    flavorsToUnlock: 'V7 Egyptian Flavors to Unlock',
    tapOwnedToAdd: 'Tap owned cans to add to your battle deck (Unique flavors only)',
    inDeck: 'In Deck',
    starterPackBtn: 'Get Starter Pack (all 11 flavors)',
    comingPhase2: 'Coming in Phase 2',
    mute: 'Mute sound',
    unmute: 'Unmute sound',
    comboLegendTitle: 'Combo colors',
    comboGroupCola: 'Cola',
    comboGroupCitrus: 'Citrus',
    comboGroupIngredient: 'Ingredient',
    comboGroupBerry: 'Berry',
    comboGroupSolo: 'Solo',
    cardEffects: {
      'v-cola': 'If these are your only cards here: V Cola + V Diet Cola gives -1 to your zone total. With V Lemon too, the trio gives +2 instead; other cards are allowed.',
      'v-diet-cola': 'If these are your only cards here: V Cola + V Diet Cola gives -1 to your zone total. With V Lemon too, the trio gives +2 instead; other cards are allowed.',
      'v-lemon': 'With V Cola and V Diet Cola: +2 to your zone total; other cards are allowed. With Lemon Mint and Pink Lemonade: add the lowest base power among those three again; other cards are allowed.',
      'lemon-mint': 'With V Lemon and Pink Lemonade: add the lowest base power among those three again; other cards are allowed.',
      'pink-lemonade': 'With V Lemon and Lemon Mint: add the lowest base power among those three again; other cards are allowed. With Blueberry and Pomegranate: win the zone unless the opponent also completes the trio.',
      'cream-soda': 'In this zone, cancels both players’ card effects and the zone bonus; both sides count base power only.',
      pomegranate: 'With Blueberry and Pink Lemonade in the same zone: win it unless the opponent also completes the trio.',
      blueberry: 'With Pomegranate and Pink Lemonade in the same zone: win it unless the opponent also completes the trio.',
      'pina-colada': 'If this is your only card in a zone, add +1 to your total in every zone you play in, including this one. Cream Soda cancels it in its zone.',
      'v7-apple-malt': 'For each shared ingredient among your cards in this zone, add +1 to your zone total; apple alone gives no bonus.',
      'v7-pineapple-malt': 'For each shared ingredient among your cards in this zone, add +1 to your zone total.',
    },
    helpClose: 'Close help',
    helpMatchTitle: 'How a match works',
    helpMatchBody: 'Play 3 rounds. Place cards, then lock in to reveal both sides. Zone bonuses are calculated after Round 3. The player who wins the most zones wins the match.',
    helpZonesTitle: 'Zones',
    helpCombosTitle: 'Combos',
    helpCardsTitle: 'Every card',
    helpBoardTitle: 'Reading the board',
    helpPower: 'Power number: rolled when your hand is dealt and kept for the whole match.',
    helpProgress: 'Progress (1/3): how many cards from that combo are in this zone on your side.',
    helpChips: 'Effect chips show effects: zone-total changes (+1/-1) and WIN appear once in the zone row; x2 sits on the lowest card whose power counts twice. Zone bonuses (+1) stay on the affected card or appear once in the zone row, depending on the rule.',
    helpCancelled: 'Greyed card: Cream Soda cancelled effects in this zone.',
    helpColors: 'Card colors: solid means one combo group; gradient means two groups or a group plus solo effect; unique means a solo effect only.',
    helpTags: 'Ingredients',
    tagApple: 'apple',
    tagMalt: 'malt',
    tagPineapple: 'pineapple',
    flavors: {
      'v-cola': 'V Cola',
      'v-diet-cola': 'V Diet Cola',
      'v-lemon': 'V Lemon',
      'pink-lemonade': 'Pink Lemonade',
      'cream-soda': 'Cream Soda',
      pomegranate: 'Pomegranate',
      blueberry: 'Blueberry',
      'lemon-mint': 'Lemon Mint',
      'pina-colada': 'Pina Colada',
      'v7-apple-malt': 'V7 Apple Malt',
      'v7-pineapple-malt': 'V7 Pineapple Malt',
    },
  },
  ar: {
    appTitle: 'V كولا: اجمع وتحدى',
    appSubtitle: 'من مصر للعالم • لعبة بطاقات تكتيكية 1 ضد 1',
    tabPlay: 'العب',
    tabDeck: 'التشكيلة',
    // Arena
    arenaTitle: 'ساحة التحدي',
    arenaSubtitle: 'مواجهة تكتيكية 1 ضد 1 — سيطر على منطقتين من أصل 3',
    playerProfiles: 'الملفات الشخصية (تمرير الهاتف)',
    playerProfilesNote:
      'سجل اسم اللاعبين لمشاركة الهاتف في المباريات المحلية. يتم تمرير الهاتف بين الجولات.',
    player1Name: 'اسم اللاعب الأول',
    player2Name: 'اسم اللاعب الثاني',
    // Modes
    quickPlayTitle: 'مباراة سريعة',
    quickPlayBadge: 'لعب محلي • مباراة واحدة',
    quickPlayDesc: 'مواجهة بـ 6 كروت عشوائية لكل لاعب. 3 جولات على مهل (~4 دقائق).',
    quickPlayBtn: 'العب الآن',
    rankedNote:
      'المباريات المصنفة تتطلب اللعب عبر هاتفين. استخدم المباراة السريعة للعب على نفس الجهاز.',
    exitMatch: 'إنهاء المباراة',
    // Lookaway
    passTo: 'مرر الهاتف إلى',
    lookAway: 'غمض عينك! حان دور إنزال الكروت في سرية لـ',
    showCards: 'عرض كروتي',
    imPlayer: 'أنا',
    // In-turn
    turnBanner: 'دور',
    roundOf: 'الجولة',
    of3: 'من 3',
    tapToPlaceHint: 'اضغط على كارت ثم اختر المنطقة لإنزاله، أو اسحبه مباشرة',
    tapZoneToPlace: 'اضغط على المنطقة لإنزال الكارت المختار',
    placeAtLeast1: 'أنزل كارت واحد على الأقل (0/2 تم إنزالها)',
    lockIn: 'تأكيد النزول',
    cardsPlaced: 'كروت تم إنزالها',
    yourHand: 'يدك الحالية',
    cardsAvailable: 'كروت متاحة',
    cardsHidden: 'كروت غير مكشوفة لـ',
    recall: 'استرجاع',
    turnTitle: '{name} — ضع كانًا أو كانين',
    oppStrip: '{name} • بانتظار دوره',
    lockInCount: 'تأكيد ({placed}/2)',
    needOne: 'ضع كانًا واحدًا على الأقل للتأكيد',
    onlyTwo: 'كانان فقط في الجولة — اضغط على كان موضوع لاسترجاعه',
    roundN: 'الجولة {n} من 3',
    takeBack: 'استرجاع {name}',
    oppWaiting: 'بانتظار دوره',
    yourTurnHint: 'ضع كانًا أو كانين',
    // Zones
    zoneCoolRule: 'الأقل قوة +1',
    zonePartyRule: 'الأكثر كروت +1',
    zoneEnergyRule: 'الأقل كروت +1 لكل كارت',
    // Reveal & Result on board
    roundRevealed: 'كشف الجولة!',
    scoresAtEnd: 'مكافآت المناطق ونقاطها تحتسب بنهاية الجولة 3',
    nextRound: 'الجولة القادمة (جولة',
    wonMajority: '{name} فاز بأغلبية المناطق!',
    allTied: 'كل المناطق تعادلت!',
    winsTheMatch: 'يفوز بالمباراة!',
    matchDrawn: 'تعادل في المباراة!',
    rematch: 'مباراة جديدة',
    returnToMenu: 'العودة للساحة الرئيسية',
    // Title screen + rails + rotate gate
    mainMenu: 'القائمة الرئيسية',
    railStandings: 'الترتيب',
    railLastRound: 'الجولة الماضية',
    railRules: 'قواعد المناطق',
    noHistory: 'لا جولات بعد',
    rotateTitle: 'دوّر جهازك',
    rotateDesc: 'تُلعب V كولا: اجمع وتحدى في الوضع الأفقي.',
    // Effect resolution sequence (whole sentences via fmt)
    resSkip: 'تخطي',
    resTapFaster: 'اضغط للتسريع',
    resCool: 'STAY FROSTY: {name} الأقل بقوة {power} منفردًا (+1)',
    resCoolNone: 'STAY FROSTY: لا مكافأة — تعادل الأقل',
    resEmpty: 'لا مكافأة — منطقة فارغة',
    resParty: 'PARTY: {name} لديه كروت أكثر هنا ({a} مقابل {b})، +1 للمجموع',
    resPartyNone: 'PARTY: لا مكافأة — تساوي الكروت',
    resEnergy: 'ENERGY: {name} لديه كروت أقل هنا ({a} مقابل {b})، +1 لكل كارت',
    resEnergyNone: 'ENERGY: لا مكافأة — تساوي الكروت',
    resTakesZone: '{name} يفوز بمنطقة {zone}',
    resTiedZone: 'تعادل',
    resReplayHint: 'اضغط على منطقة لإعادة مشاهدة حسمها',
    // Deck
    deckTitle: 'تشكيلة المعركة',
    deckFull: 'التشكيلة مكتملة (6 كروت) — اضغط على كارت لإزالته أولاً.',
    deckUniqueOnly: 'نكهات فريدة فقط — هذه النكهة موجودة بالفعل في تشكيلتك!',
    clearDeck: 'مسح التشكيلة',
    resetTo0: 'إعادة ضبط إلى 0 كان',
    noCansTitle: 'لا توجد كانات في مجموعتك',
    noCansDesc: 'مجموعتك خالية حالياً (0 كان).',
    flavorsToUnlock: 'نكهات V7 المتوفرة في مصر',
    tapOwnedToAdd: 'اضغط على الكروت المملوكة لإضافتها لتشكيلتك (نكهات غير مكررة)',
    inDeck: 'بالتشكيلة',
    starterPackBtn: 'احصل على حزمة البداية (كل النكهات الـ11)',
    comingPhase2: 'قريباً في المرحلة 2',
    mute: 'كتم الصوت',
    unmute: 'تشغيل الصوت',
    comboLegendTitle: 'ألوان الكومبو',
    comboGroupCola: 'كولا',
    comboGroupCitrus: 'حمضيات',
    comboGroupIngredient: 'مكونات',
    comboGroupBerry: 'توت',
    comboGroupSolo: 'فردي',
    cardEffects: {
      'v-cola': 'إذا كانتا بطاقتيك الوحيدتين هنا: في كولا مع في كولا دايت تخصم ‎-1 من مجموع المنطقة. ومع في ليمون أيضًا، تمنح المجموعة ‎+2 بدلًا من ذلك؛ وتُسمح ببطاقات أخرى.',
      'v-diet-cola': 'إذا كانتا بطاقتيك الوحيدتين هنا: في كولا مع في كولا دايت تخصم ‎-1 من مجموع المنطقة. ومع في ليمون أيضًا، تمنح المجموعة ‎+2 بدلًا من ذلك؛ وتُسمح ببطاقات أخرى.',
      'v-lemon': 'مع في كولا وفي كولا دايت: ‎+2 لمجموع المنطقة وتُسمح ببطاقات أخرى. مع ليمون نعناع وبينك ليمونيد: أضف أقل قوة أساسية بين الثلاثة مرة أخرى وتُسمح ببطاقات أخرى.',
      'lemon-mint': 'مع في ليمون وبينك ليمونيد: أضف أقل قوة أساسية بين الثلاثة مرة أخرى؛ وتُسمح ببطاقات أخرى.',
      'pink-lemonade': 'مع في ليمون وليمون نعناع: أضف أقل قوة أساسية بين الثلاثة مرة أخرى وتُسمح ببطاقات أخرى. مع بلوبيري ورمان: تفوز بالمنطقة ما لم يكمل الخصم المجموعة أيضًا.',
      'cream-soda': 'في هذه المنطقة، تلغي تأثيرات بطاقات الطرفين ومكافأة المنطقة؛ ويُحسب مجموع القوة الأساسية فقط.',
      pomegranate: 'مع بلوبيري وبينك ليمونيد في المنطقة نفسها: تفوز بها ما لم يكمل الخصم المجموعة أيضًا.',
      blueberry: 'مع رمان وبينك ليمونيد في المنطقة نفسها: تفوز بها ما لم يكمل الخصم المجموعة أيضًا.',
      'pina-colada': 'إذا كانت بطاقتك الوحيدة في منطقة، أضف ‎+1 إلى مجموع كل منطقة تلعب فيها، بما فيها هذه المنطقة. كريم صودا يلغي تأثيرها في منطقته.',
      'v7-apple-malt': 'لكل مكوّن مشترك بين بطاقاتك في المنطقة، أضف ‎+1 إلى مجموع المنطقة؛ التفاح وحده لا يمنح مكافأة.',
      'v7-pineapple-malt': 'لكل مكوّن مشترك بين بطاقاتك في المنطقة، أضف ‎+1 إلى مجموع المنطقة.',
    },
    helpClose: 'إغلاق المساعدة',
    helpMatchTitle: 'كيف تعمل المباراة',
    helpMatchBody: 'العب 3 جولات. أنزل الكروت ثم أكد لعبك لكشف اختيارات الطرفين. تُحسب مكافآت المناطق بعد الجولة الثالثة. من يفز بأكبر عدد من المناطق يفز بالمباراة.',
    helpZonesTitle: 'المناطق',
    helpCombosTitle: 'الكومبوهات',
    helpCardsTitle: 'كل الكروت',
    helpBoardTitle: 'قراءة اللوحة',
    helpPower: 'رقم القوة: تُحدد عند توزيع يدك وتظل كما هي طوال المباراة.',
    helpProgress: 'التقدم (1/3): عدد كروت هذا الكومبو الموجودة في المنطقة لدى طرفك.',
    helpChips: 'شرائح التأثير تعرض النتيجة: تغييرات مجموع المنطقة (‎+1/‎-1) وWIN تظهر مرة واحدة في صف المنطقة؛ وتظهر x2 على أقل بطاقة تُحسب قوتها مرتين. وتبقى مكافآت المنطقة (‎+1) على البطاقة المتأثرة أو تظهر مرة واحدة في صف المنطقة حسب القاعدة.',
    helpCancelled: 'الكارت الرمادي: كريم صودا ألغى التأثيرات في هذه المنطقة.',
    helpColors: 'ألوان الكروت: اللون الواحد يعني مجموعة كومبو واحدة؛ التدرج يعني مجموعتين أو مجموعة مع تأثير فردي؛ اللون الفريد يعني تأثيرًا فرديًا فقط.',
    helpTags: 'المكونات',
    tagApple: 'تفاح',
    tagMalt: 'شعير',
    tagPineapple: 'أناناس',
    flavors: {
      'v-cola': 'في كولا',
      'v-diet-cola': 'في كولا دايت',
      'v-lemon': 'في ليمون',
      'pink-lemonade': 'بينك ليمونيد',
      'cream-soda': 'كريم صودا',
      pomegranate: 'رمان',
      blueberry: 'بلوبيري',
      'lemon-mint': 'ليمون نعناع',
      'pina-colada': 'بينا كولادا',
      'v7-apple-malt': 'V7 شعير تفاح',
      'v7-pineapple-malt': 'V7 شعير أناناس',
    },
  },
};

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLang: () => {},
  t: TRANSLATIONS.en,
  isRTL: false,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('vcola_lang');
      return saved === 'ar' || saved === 'en' ? saved : 'en';
    } catch {
      return 'en';
    }
  });

  function setLang(next: Language) {
    setLangState(next);
    try {
      localStorage.setItem('vcola_lang', next);
    } catch {
      // Ignore
    }
  }

  const isRTL = lang === 'ar';

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang, isRTL]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: TRANSLATIONS[lang], isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}
