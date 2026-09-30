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
      'Instant showdown with 6 unique cans dealt to each player. Fast 3-round battle (~90s).',
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
    // Deck
    deckTitle: 'Battle Deck',
    deckFull: 'Deck full (6 cards) — tap a slot to remove one first.',
    deckUniqueOnly: 'Unique flavors only — this flavor is already in your deck!',
    clearDeck: 'Clear Deck',
    resetTo0: 'Reset to 0 cans',
    noCansTitle: '📦 No Cans in Collection',
    noCansDesc: 'Your collection currently has 0 cans.',
    flavorsToUnlock: 'V7 Egyptian Flavors to Unlock',
    tapOwnedToAdd: 'Tap owned cans to add to your battle deck (Unique flavors only)',
    inDeck: 'In Deck',
    starterPackBtn: '🎁 Get Starter Pack (all 11 flavors)',
    comingPhase2: 'Coming in Phase 2',
    mute: 'Mute sound',
    unmute: 'Unmute sound',
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
    quickPlayDesc:
      'مواجهة فورية بـ 6 كروت عشوائية لكل لاعب. 3 جولات مليئة بالإثارة والسرعة (~90 ثانية).',
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
    // Deck
    deckTitle: 'تشكيلة المعركة',
    deckFull: 'التشكيلة مكتملة (6 كروت) — اضغط على كارت لإزالته أولاً.',
    deckUniqueOnly: 'نكهات فريدة فقط — هذه النكهة موجودة بالفعل في تشكيلتك!',
    clearDeck: 'مسح التشكيلة',
    resetTo0: 'إعادة ضبط إلى 0 كان',
    noCansTitle: '📦 لا توجد كانات في مجموعتك',
    noCansDesc: 'مجموعتك خالية حالياً (0 كان).',
    flavorsToUnlock: 'نكهات V7 المتوفرة في مصر',
    tapOwnedToAdd: 'اضغط على الكروت المملوكة لإضافتها لتشكيلتك (نكهات غير مكررة)',
    inDeck: 'بالتشكيلة',
    starterPackBtn: '🎁 احصل على حزمة البداية (كل النكهات الـ11)',
    comingPhase2: 'قريباً في المرحلة 2',
    mute: 'كتم الصوت',
    unmute: 'تشغيل الصوت',
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
