// Morning & evening adhkar (remembrances) — the well-established core set from the
// authentic sunnah (most appear in Hisn al-Muslim with sahih chains).
//
// _audit: wording follows the common printed Hisn al-Muslim text; translations are
// simplified for family reading. Sources listed are the primary collections; a few
// gradings are debated (noted inline) — worth a final scholarly confirmation, same
// convention as quotes.json. The counts (×3, ×7, ×10, ×100) follow the narrations.
//
// `morning` / `evening` flags control which list(s) a dhikr appears in.

export const ADHKAR = [
  {
    id: 'kursi',
    title: 'Ayat al-Kursi',
    arabic: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَنْ ذَا الَّذِي يَشْفَعُ عِنْدَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ',
    translation: 'Allah — there is no god but He, the Ever-Living, the Sustainer… (Quran 2:255). Whoever recites it in the morning is protected until evening, and in the evening until morning.',
    count: 1,
    source: 'Quran 2:255 · al-Hakim, an-Nasa\'i (sahih)',
    morning: true, evening: true,
  },
  {
    id: 'three-quls',
    title: 'Al-Ikhlas, Al-Falaq, An-Nas',
    arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ … قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ … قُلْ أَعُوذُ بِرَبِّ النَّاسِ …',
    translation: 'The three Quls (Surahs 112, 113, 114) — recite each three times; they suffice you against everything.',
    count: 3,
    source: 'Abu Dawud, at-Tirmidhi (hasan sahih)',
    morning: true, evening: true,
  },
  {
    id: 'sayyid-istighfar',
    title: 'Sayyid al-Istighfar',
    arabic: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ',
    translation: 'O Allah, You are my Lord; there is no god but You. You created me and I am Your slave… Whoever says it with conviction in the morning or evening and dies that day/night enters Paradise.',
    count: 1,
    source: 'Sahih al-Bukhari',
    morning: true, evening: true,
  },
  {
    id: 'asbahna',
    title: 'Asbahna / Amsayna',
    arabic: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    translation: 'We have entered the morning and the dominion belongs to Allah… (in the evening: "Amsayna wa amsa-l-mulku lillah…").',
    count: 1,
    source: 'Sahih Muslim',
    morning: true, evening: true,
  },
  {
    id: 'bika-asbahna',
    title: 'Allahumma bika asbahna',
    arabic: 'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ',
    translation: 'O Allah, by You we enter the morning and by You we enter the evening; by You we live and by You we die, and to You is the resurrection. (Evening ends: "…and to You is the final return.")',
    count: 1,
    source: 'at-Tirmidhi (hasan)',
    morning: true, evening: true,
  },
  {
    id: 'subhan-100',
    title: 'SubhanAllahi wa bihamdih',
    arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
    translation: 'Glory be to Allah and praise Him — one hundred times; sins are forgiven even if like the foam of the sea.',
    count: 100,
    source: 'Sahih Muslim',
    morning: true, evening: true,
  },
  {
    id: 'tahlil-10',
    title: 'La ilaha illallah… ×10',
    arabic: 'لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ',
    translation: 'None has the right to be worshipped but Allah alone, without partner; His is the dominion and the praise, and He is able to do all things — ten times.',
    count: 10,
    source: 'an-Nasa\'i; cf. Bukhari & Muslim (virtue of saying it)',
    morning: true, evening: true,
  },
  {
    id: 'raditu',
    title: 'Raditu billahi rabban',
    arabic: 'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا',
    translation: 'I am pleased with Allah as my Lord, Islam as my religion, and Muhammad ﷺ as my Prophet — three times; Paradise becomes his right.',
    count: 3,
    source: 'Abu Dawud, at-Tirmidhi (graded hasan by some — confirm)',
    morning: true, evening: true,
  },
  {
    id: 'bismillah-ladhi',
    title: 'Bismillahil-ladhi la yadurru',
    arabic: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    translation: 'In the Name of Allah, with Whose Name nothing on earth or in heaven can cause harm… — three times; nothing shall harm him.',
    count: 3,
    source: 'Abu Dawud, at-Tirmidhi (sahih)',
    morning: true, evening: true,
  },
  {
    id: 'hasbiyallah',
    title: 'Hasbiyallahu la ilaha illa huwa',
    arabic: 'حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ',
    translation: 'Allah is sufficient for me; there is no god but He. In Him I trust, and He is the Lord of the Mighty Throne — seven times; Allah suffices him in what concerns him.',
    count: 7,
    source: 'Abu Dawud (chain debated — confirm; the Quranic wording is 9:129)',
    morning: true, evening: true,
  },
  {
    id: 'afini',
    title: 'Allahumma \'afini',
    arabic: 'اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَٰهَ إِلَّا أَنْتَ',
    translation: 'O Allah, grant my body health; O Allah, grant my hearing health; O Allah, grant my sight health. There is no god but You — three times.',
    count: 3,
    source: 'Abu Dawud (hasan)',
    morning: true, evening: true,
  },
  {
    id: 'audhu-kalimat',
    title: 'A\'udhu bikalimatillah',
    arabic: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ',
    translation: 'I seek refuge in the perfect words of Allah from the evil of what He has created — three times in the evening; nothing will harm you that night.',
    count: 3,
    source: 'Sahih Muslim',
    morning: false, evening: true,
  },
]

export const morningAdhkar = () => ADHKAR.filter(d => d.morning)
export const eveningAdhkar = () => ADHKAR.filter(d => d.evening)
