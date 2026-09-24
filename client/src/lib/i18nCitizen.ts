/**
 * Citizen-facing i18n extension bundle (gap 9)
 *
 * The base bundles in client/src/lib/i18n.ts already cover nav / common /
 * dsar / breach / dpco / enforcement. This module adds the missing
 * citizen-facing key sets — whistleblower intake and the public compliance
 * registry header — plus a few extra DSAR landing keys, via
 * i18n.addResourceBundle (deep merge), so the base file stays untouched.
 *
 * Languages: en, ha (Hausa), yo (Yorùbá), ig (Igbo). French falls back to en
 * for these keys until translated.
 */
import i18n from "./i18n";

const en = {
  whistleblower: {
    title: "Whistleblower Portal",
    subtitle: "Report data protection violations safely and anonymously",
    protectionNotice: "You are protected under the NDPA 2023 whistleblower provisions. Your identity is never disclosed without your consent.",
    submitReport: "Submit a Report",
    trackReport: "Track My Report",
    reportType: "Violation Category",
    types: {
      data_breach: "Data breach",
      unlawful_processing: "Unlawful data processing",
      consent_violation: "Consent violation",
      cross_border: "Unlawful cross-border transfer",
      bribery: "Bribery / corruption",
    },
    description: "Describe what happened (minimum 50 characters)",
    orgName: "Organisation involved (optional)",
    anonymous: "Stay anonymous",
    contactEmail: "Contact email (optional)",
    submit: "Submit Report",
    accessTokenNotice: "Save your access token. It is shown only once and lets you follow up on your report securely.",
    followUp: "Follow up on a report",
    accessToken: "Access token",
    sendMessage: "Send Message",
    retaliation: "Report employer retaliation",
    successMessage: "Your report has been submitted. Reference: {{ref}}",
  },
  registry: {
    title: "Public Compliance Registry",
    subtitle: "Check the data protection compliance status of registered organisations in Nigeria",
    search: "Search organisations",
    searchPlaceholder: "Enter organisation name or registration number",
    sector: "Sector",
    status: "Compliance status",
    statuses: {
      compliant: "Compliant",
      partially_compliant: "Partially compliant",
      non_compliant: "Non-compliant",
      pending: "Pending assessment",
    },
    score: "Compliance score",
    totalRegistered: "Registered organisations",
    compliantCount: "Compliant",
    avgScore: "Average score",
    lastAssessed: "Last assessed",
    noResults: "No organisations match your search",
  },
  dsarLanding: {
    heroTitle: "Know what organisations hold about you",
    heroSubtitle: "Submit and track data subject requests in your language, free of charge.",
    rightsHeading: "Your rights under the NDPA 2023",
    startRequest: "Start a Request",
    howItWorks: "How it works",
    step1: "Describe your request and the organisation involved",
    step2: "Receive a reference number to track progress",
    step3: "The organisation must respond within 30 days",
  },
  language: {
    label: "Language",
    english: "English",
    hausa: "Hausa",
    yoruba: "Yorùbá",
    igbo: "Igbo",
  },
};

const ha: typeof en = {
  whistleblower: {
    title: "Tashar Masu Bayar da Rahoto",
    subtitle: "Bayar da rahoton keta kare bayanan cikin aminci da a ɓoye",
    protectionNotice: "Ana kare ka ƙarƙashin tanadin NDPA 2023 na masu bayar da rahoto. Ba a bayyana ainihinka ba tare da izininka ba.",
    submitReport: "Aika Rahoto",
    trackReport: "Bi Rahotona",
    reportType: "Nau'in Keta Doka",
    types: {
      data_breach: "Keta bayanan",
      unlawful_processing: "Sarrafa bayanan ba bisa doka ba",
      consent_violation: "Keta izini",
      cross_border: "Canja bayanan zuwa waje ba bisa doka ba",
      bribery: "Cin hanci / rashawa",
    },
    description: "Bayyana abin da ya faru (aƙalla haruffa 50)",
    orgName: "Ƙungiyar da ake zargi (na zaɓi ne)",
    anonymous: "Ci gaba a ɓoye",
    contactEmail: "Imel ɗin tuntuɓa (na zaɓi ne)",
    submit: "Aika Rahoto",
    accessTokenNotice: "Ajiye alamar shigarka. Ana nuna ta sau ɗaya kawai kuma tana ba ka damar bin rahotonka cikin aminci.",
    followUp: "Bin diddigin rahoto",
    accessToken: "Alamar shiga",
    sendMessage: "Aika Saƙo",
    retaliation: "Bayar da rahoton ramuwar gayya daga ma'aikata",
    successMessage: "An aika rahotonka. Lambar tunani: {{ref}}",
  },
  registry: {
    title: "Rajistar Bin Doka na Jama'a",
    subtitle: "Duba matsayin bin dokar kare bayanan ƙungiyoyin da aka yi rajista a Najeriya",
    search: "Nemi ƙungiyoyi",
    searchPlaceholder: "Shigar da sunan ƙungiya ko lambar rajista",
    sector: "Sashe",
    status: "Matsayin bin doka",
    statuses: {
      compliant: "Masu bin doka",
      partially_compliant: "Bin doka ɗan ɗan",
      non_compliant: "Ba su bi doka ba",
      pending: "Ana jiran kimantawa",
    },
    score: "Maki na bin doka",
    totalRegistered: "Ƙungiyoyin da aka yi rajista",
    compliantCount: "Masu bin doka",
    avgScore: "Matsakaicin maki",
    lastAssessed: "Kwanan kimantawa",
    noResults: "Babu ƙungiyar da ta dace da bincikenka",
  },
  dsarLanding: {
    heroTitle: "San abin da ƙungiyoyi ke da shi game da kai",
    heroSubtitle: "Aika kuma bi buƙatun bayanan ka cikin harshenka, kyauta.",
    rightsHeading: "Haƙƙoƙinka ƙarƙashin NDPA 2023",
    startRequest: "Fara Buƙata",
    howItWorks: "Yadda yake aiki",
    step1: "Bayyana buƙatarka da ƙungiyar da take da alaƙa",
    step2: "Sami lambar tunani don bin ci gaba",
    step3: "Ƙungiya dole ta amsa cikin kwanaki 30",
  },
  language: {
    label: "Harshe",
    english: "Turanci",
    hausa: "Hausa",
    yoruba: "Yorùbá",
    igbo: "Igbo",
  },
};

const yo: typeof en = {
  whistleblower: {
    title: "Ọnà Abùdá Olùsọ̀fín",
    subtitle: "Jábọ̀ ìrúfìn ààbò dátà ní ààbò àti ní ìkọ̀kọ̀",
    protectionNotice: "Ààbò wà fún ọ lábẹ́ àwọn ìláná NDPA 2023 fún àwọn olùsọ̀fín. A kò ní fi ìdánimọ̀ rẹ hàn láìní àṣẹ rẹ.",
    submitReport: "Fi Jábọ̀ Ránṣẹ́",
    trackReport: "Tọpinpin Jábọ̀ Mi",
    reportType: "Oríṣi Ìrúfìn",
    types: {
      data_breach: "Ìrúfìn dátà",
      unlawful_processing: "Ìṣàmúlò dátà láìléṣe",
      consent_violation: "Ìrúfìn ìfọwọ̀sí",
      cross_border: "Ìgbé dátà kọjà ààlà orílẹ̀ láìléṣe",
      bribery: "Ìwà ìmábàrà / ètùtù",
    },
    description: "Ṣàlàyé ohun tó ṣẹlẹ̀ (ó kéré jù àwọn lẹ́tà 50)",
    orgName: "Ìlú tó ní kán lọ́rọ̀ (kò ṣe pàtàkì)",
    anonymous: "Dúró ní ìkọ̀kọ̀",
    contactEmail: "Íméèlì ìbáṣepọ̀ (kò ṣe pàtàkì)",
    submit: "Fi Jábọ̀ Ránṣẹ́",
    accessTokenNotice: "Fipamọ́ àmì-ìwọlé rẹ. A fi hàn léẹkan ṣoṣo, ó sì jẹ́ kí o tẹ̀le jábọ̀ rẹ ní ààbò.",
    followUp: "Tẹ̀le jábọ̀ kan",
    accessToken: "Àmì ìwọlé",
    sendMessage: "Fi Ìfiránṣẹ́ Ránṣẹ́",
    retaliation: "Jábọ̀ ìyípayà ẹniṣẹ́ ọ̀gá",
    successMessage: "A ti fi jábọ̀ rẹ ránṣẹ́. Nọ́ńbà àtọ́ka: {{ref}}",
  },
  registry: {
    title: "Ìforúkọsílẹ̀ Ìtẹ̀lé Òfin Gbangba",
    subtitle: "Ṣàyẹ̀wò ipò ìtẹ̀lé òfin ààbò dátà àwọn ilé-iṣẹ́ tó forúkọsílẹ̀ ní Nàìjíríà",
    search: "Wá ilé-iṣẹ́",
    searchPlaceholder: "Tẹ orúkọ ilé-iṣẹ́ tàbí nọ́ńbà ìforúkọsílẹ̀ sínú",
    sector: "Ẹ̀yà iṣẹ́",
    status: "Ipò ìtẹ̀lé òfin",
    statuses: {
      compliant: "Ń tẹ̀lé òfin",
      partially_compliant: "Ń tẹ̀lé òfin díẹ̀",
      non_compliant: "Kò tẹ̀lé òfin",
      pending: "Ń dúró de ìṣirò",
    },
    score: "Àmì ìtẹ̀lé òfin",
    totalRegistered: "Àwọn ilé-iṣẹ́ tó forúkọsílẹ̀",
    compliantCount: "Ń tẹ̀lé òfin",
    avgScore: "Àmì àárín",
    lastAssessed: "Ìṣirò gbẹ̀yìn",
    noResults: "Kò sí ilé-iṣẹ́ tó bá ìwá rẹ mu",
  },
  dsarLanding: {
    heroTitle: "Mọ ohun tí àwọn ilé-iṣẹ́ ní nípa rẹ",
    heroSubtitle: "Fi àti tọpinpin àwọn ìbéèrè dátà rẹ ní èdè rẹ, lọ́fẹ̀ẹ́.",
    rightsHeading: "Àwọn ẹ̀tọ́ rẹ lábẹ́ NDPA 2023",
    startRequest: "Bẹ̀rẹ̀ Ìbéèrè",
    howItWorks: "Bí ó ṣe ń ṣiṣẹ́",
    step1: "Ṣàlàyé ìbéèrè rẹ àti ilé-iṣẹ́ tó ní kán lọ́rọ̀",
    step2: "Gba nọ́ńbà àtọ́ka láti tẹ̀le ìlọsíwájú",
    step3: "Ilé-iṣẹ́ gbọ́dọ̀ dáhùn láàárín ọjọ́ 30",
  },
  language: {
    label: "Èdè",
    english: "Èdè Gẹ̀ẹ́sì",
    hausa: "Hausa",
    yoruba: "Yorùbá",
    igbo: "Igbo",
  },
};

const ig: typeof en = {
  whistleblower: {
    title: "Ọnụ Ọgụ Ndị Mkpesa",
    subtitle: "Kpesa imebi iwu nchekwa data n'enweghị nsogbu na nzuzo",
    protectionNotice: "Echekwara gi n'okpuru iwu NDPA 2023 maka ndị mkpesa. A gaghị ekpughe njirimara gi na-enweghị ikike gi.",
    submitReport: "Ziga Mkpesa",
    trackReport: "Soro Mkpesa M",
    reportType: "Ụdị Mmebi Iwu",
    types: {
      data_breach: "Mmebi data",
      unlawful_processing: "Ịrụ ọrụ data na iwu na-akwadoghị",
      consent_violation: "Mmebi nkwenye",
      cross_border: "Ịbufe data na mba ọzọ na iwu na-akwadoghị",
      bribery: "Ịnụ ego / nrụrụ aka",
    },
    description: "Kọwaa ihe mere (opekempe mkpụrụedemede 50)",
    orgName: "Ọtụtụ metụtara (ọ bụ nhọrọ)",
    anonymous: "Nọrọ na nzuzo",
    contactEmail: "Email kọntaktị (ọ bụ nhọrọ)",
    submit: "Ziga Mkpesa",
    accessTokenNotice: "Chekwaa ngosi njirimara gi. A na-egosi ya otu ugboro naanị ma o na-enye gi ohere iso mkpesa gi so.",
    followUp: "Soro mkpesa",
    accessToken: "Ngosi njirimara",
    sendMessage: "Ziga Ozi",
    retaliation: "Kpesa ịmepụ ihe ọjọọ n'ọrụ",
    successMessage: "Ezigaala mkpesa gi. Nọmba ntụaka: {{ref}}",
  },
  registry: {
    title: "Ndekọ Ịrube Isi N'iwu Nke ọhaneze",
    subtitle: "Lelee ọnọdụ ịrube isi n'iwu nchekwa data nke ụlọ ọrụ edebanyere aha na Naịjirịa",
    search: "Chọọ ụlọ ọrụ",
    searchPlaceholder: "Tinye aha ụlọ ọrụ ma ọ bụ nọmba ndebanye aha",
    sector: "Ngalaba",
    status: "Ọnọdụ ịrube isi n'iwu",
    statuses: {
      compliant: "Na-erube isi n'iwu",
      partially_compliant: "Na-erube isi n'iwu obere",
      non_compliant: "Anaghị erube isi n'iwu",
      pending: "Na-echere nyocha",
    },
    score: "Akara ịrube isi n'iwu",
    totalRegistered: "Ụlọ ọrụ edebanyere aha",
    compliantCount: "Na-erube isi n'iwu",
    avgScore: "Akara nke etiti",
    lastAssessed: "Nyocha ikpeazụ",
    noResults: "Ọ dịghị ụlọ ọrụ dabara na nchọgharị gi",
  },
  dsarLanding: {
    heroTitle: "Mara ihe ụlọ ọrụ nwere banyere gi",
    heroSubtitle: "Ziga ma soro arịrịrị data gi n'asụsụ gi, n'efu.",
    rightsHeading: "Ikike gi n'okpuru NDPA 2023",
    startRequest: "Malite Arịrịrị",
    howItWorks: "Otu ọ si arụ ọrụ",
    step1: "Kọwaa arịrịrị gi na ụlọ ọrụ metụtara",
    step2: "Nweta nọmba ntụaka iji soro ọganihu",
    step3: "Ụlọ ọrụ ga-aza n'ime ụbọchị 30",
  },
  language: {
    label: "Asụsụ",
    english: "Bekee",
    hausa: "Hausa",
    yoruba: "Yorùbá",
    igbo: "Igbo",
  },
};

export const CITIZEN_I18N_BUNDLES: Record<string, typeof en> = { en, ha, yo, ig };

let registered = false;

/** Idempotently merge the citizen key sets into the shared i18next instance. */
export function registerCitizenBundles(): void {
  if (registered) return;
  registered = true;
  for (const [lang, bundle] of Object.entries(CITIZEN_I18N_BUNDLES)) {
    i18n.addResourceBundle(lang, "translation", bundle, true /* deep */, true /* overwrite */);
  }
}

registerCitizenBundles();

export default i18n;
