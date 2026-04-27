import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Body, Equator, Horizon, Observer } from "astronomy-engine";

type SkyKind = "body" | "star" | "dso";

type Difficulty = "facile" | "media" | "difficile";

type SkyObject = {
  kind: SkyKind;
  label: string;
  group: string;
  body?: Body;
  raHours?: number;
  decDeg?: number;
  priority: number;
  mag?: number;
  catalog?: string;
  difficulty?: Difficulty;
  recommendedTool?: string;
  bestMonths?: number[];
  minUsefulAltitude?: number;
  requiredSunAltitude?: number;
  note?: string;
};

type AltAz = {
  altitude: number;
  azimuth: number;
};

type SkyResult = SkyObject & {
  altitude: number;
  azimuth: number;
  deltaFromHeading: number | null;
  absDeltaFromHeading: number | null;
  visible: boolean;
  qualityLabel: string;
  qualityScore: number;
};

type CompassMode =
  | "off"
  | "ios-webkit"
  | "absolute"
  | "relative"
  | "unavailable"
  | "denied";

type CalibrationState = {
  score: number;
  label: string;
  detail: string;
  reliable: boolean;
  warning: string | null;
};

type HeadingSample = {
  t: number;
  heading: number;
};

type AdvisorSample = {
  date: Date;
  altitude: number;
  azimuth: number;
  sunAltitude: number;
  usable: boolean;
};

type AdvisorWindow = {
  start: Date;
  end: Date;
  minutes: number;
};

type VisibilityAdvice = SkyObject & {
  currentAltitude: number;
  currentAzimuth: number;
  bestTime: Date;
  bestAltitude: number;
  bestAzimuth: number;
  usefulWindows: AdvisorWindow[];
  usefulMinutes: number;
  status: "Ora" | "Più tardi" | "Basso" | "Non consigliato" | "Sole";
  reason: string;
  advisorScore: number;
  isCurrentlyUseful: boolean;
  seasonLabel: string;
};

const ADVISOR_SCAN_HOURS = 18;
const ADVISOR_STEP_MINUTES = 15;

const SKY_OBJECTS: SkyObject[] = [
  {
    kind: "body",
    body: Body.Sun,
    label: "Sole",
    group: "Sistema solare",
    priority: 40,
  },
  {
    kind: "body",
    body: Body.Moon,
    label: "Luna",
    group: "Sistema solare",
    priority: 100,
  },
  {
    kind: "body",
    body: Body.Mercury,
    label: "Mercurio",
    group: "Pianeti",
    priority: 62,
  },
  {
    kind: "body",
    body: Body.Venus,
    label: "Venere",
    group: "Pianeti",
    priority: 98,
  },
  {
    kind: "body",
    body: Body.Mars,
    label: "Marte",
    group: "Pianeti",
    priority: 86,
  },
  {
    kind: "body",
    body: Body.Jupiter,
    label: "Giove",
    group: "Pianeti",
    priority: 94,
  },
  {
    kind: "body",
    body: Body.Saturn,
    label: "Saturno",
    group: "Pianeti",
    priority: 88,
  },
  {
    kind: "body",
    body: Body.Uranus,
    label: "Urano",
    group: "Pianeti",
    priority: 50,
  },
  {
    kind: "body",
    body: Body.Neptune,
    label: "Nettuno",
    group: "Pianeti",
    priority: 48,
  },

  {
    kind: "star",
    label: "Polare",
    group: "Stelle guida",
    raHours: 2.5303,
    decDeg: 89.2641,
    priority: 88,
    mag: 2.0,
  },
  {
    kind: "star",
    label: "Sirio",
    group: "Stelle luminose",
    raHours: 6.7525,
    decDeg: -16.7161,
    priority: 93,
    mag: -1.46,
  },
  {
    kind: "star",
    label: "Vega",
    group: "Stelle luminose",
    raHours: 18.6156,
    decDeg: 38.7837,
    priority: 90,
    mag: 0.03,
  },
  {
    kind: "star",
    label: "Arturo",
    group: "Stelle luminose",
    raHours: 14.261,
    decDeg: 19.1825,
    priority: 88,
    mag: -0.05,
  },
  {
    kind: "star",
    label: "Capella",
    group: "Stelle luminose",
    raHours: 5.2782,
    decDeg: 45.998,
    priority: 84,
    mag: 0.08,
  },
  {
    kind: "star",
    label: "Rigel",
    group: "Stelle luminose",
    raHours: 5.2423,
    decDeg: -8.2016,
    priority: 81,
    mag: 0.13,
  },
  {
    kind: "star",
    label: "Betelgeuse",
    group: "Stelle luminose",
    raHours: 5.9195,
    decDeg: 7.4071,
    priority: 82,
    mag: 0.5,
  },
  {
    kind: "star",
    label: "Aldebaran",
    group: "Stelle luminose",
    raHours: 4.5987,
    decDeg: 16.5093,
    priority: 76,
    mag: 0.85,
  },
  {
    kind: "star",
    label: "Altair",
    group: "Stelle luminose",
    raHours: 19.8464,
    decDeg: 8.8683,
    priority: 78,
    mag: 0.77,
  },
  {
    kind: "star",
    label: "Deneb",
    group: "Stelle luminose",
    raHours: 20.6905,
    decDeg: 45.2803,
    priority: 77,
    mag: 1.25,
  },
  {
    kind: "star",
    label: "Antares",
    group: "Stelle luminose",
    raHours: 16.4901,
    decDeg: -26.432,
    priority: 75,
    mag: 1.06,
  },

  {
    kind: "dso",
    label: "Galassia di Andromeda",
    catalog: "M31",
    group: "Deep Sky · Galassie",
    raHours: 0.7123,
    decDeg: 41.269,
    priority: 98,
    mag: 3.4,
    difficulty: "facile",
    recommendedTool: "occhio nudo / binocolo",
    bestMonths: [9, 10, 11, 12],
    minUsefulAltitude: 25,
    requiredSunAltitude: -10,
    note: "Grande e diffusa: meglio cielo buio, binocolo ideale.",
  },
  {
    kind: "dso",
    label: "Pleiadi",
    catalog: "M45",
    group: "Deep Sky · Ammassi aperti",
    raHours: 3.79,
    decDeg: 24.1167,
    priority: 99,
    mag: 1.6,
    difficulty: "facile",
    recommendedTool: "occhio nudo / binocolo",
    bestMonths: [11, 12, 1, 2, 3],
    minUsefulAltitude: 20,
    requiredSunAltitude: -6,
    note: "Uno degli oggetti più facili: ottimo anche a occhio nudo.",
  },
  {
    kind: "dso",
    label: "Nebulosa di Orione",
    catalog: "M42",
    group: "Deep Sky · Nebulose",
    raHours: 5.591,
    decDeg: -5.45,
    priority: 97,
    mag: 4.0,
    difficulty: "facile",
    recommendedTool: "binocolo / piccolo telescopio",
    bestMonths: [12, 1, 2, 3],
    minUsefulAltitude: 20,
    requiredSunAltitude: -8,
    note: "Molto riconoscibile nella spada di Orione.",
  },
  {
    kind: "dso",
    label: "Presepe",
    catalog: "M44",
    group: "Deep Sky · Ammassi aperti",
    raHours: 8.67,
    decDeg: 19.67,
    priority: 88,
    mag: 3.7,
    difficulty: "facile",
    recommendedTool: "binocolo",
    bestMonths: [2, 3, 4, 5],
    minUsefulAltitude: 25,
    requiredSunAltitude: -8,
    note: "Ammasso largo: il binocolo è spesso meglio del telescopio.",
  },
  {
    kind: "dso",
    label: "Doppio Ammasso",
    catalog: "NGC 869/884",
    group: "Deep Sky · Ammassi aperti",
    raHours: 2.333,
    decDeg: 57.13,
    priority: 90,
    mag: 4.3,
    difficulty: "facile",
    recommendedTool: "binocolo / telescopio basso ingrandimento",
    bestMonths: [9, 10, 11, 12, 1],
    minUsefulAltitude: 25,
    requiredSunAltitude: -8,
    note: "Bellissimo in binocolo; molto alto alle nostre latitudini.",
  },
  {
    kind: "dso",
    label: "Ammasso di Ercole",
    catalog: "M13",
    group: "Deep Sky · Ammassi globulari",
    raHours: 16.695,
    decDeg: 36.46,
    priority: 84,
    mag: 5.8,
    difficulty: "media",
    recommendedTool: "binocolo / telescopio",
    bestMonths: [5, 6, 7, 8],
    minUsefulAltitude: 30,
    requiredSunAltitude: -10,
    note: "A occhio nudo solo con cielo molto buio; meglio telescopio.",
  },
  {
    kind: "dso",
    label: "Nebulosa Anello",
    catalog: "M57",
    group: "Deep Sky · Nebulose planetarie",
    raHours: 18.893,
    decDeg: 33.03,
    priority: 74,
    mag: 8.8,
    difficulty: "media",
    recommendedTool: "telescopio",
    bestMonths: [6, 7, 8, 9],
    minUsefulAltitude: 35,
    requiredSunAltitude: -12,
    note: "Piccola: richiede telescopio e buon puntamento.",
  },
  {
    kind: "dso",
    label: "Galassia Triangolo",
    catalog: "M33",
    group: "Deep Sky · Galassie",
    raHours: 1.564,
    decDeg: 30.66,
    priority: 72,
    mag: 5.7,
    difficulty: "difficile",
    recommendedTool: "binocolo + cielo buio",
    bestMonths: [10, 11, 12],
    minUsefulAltitude: 30,
    requiredSunAltitude: -12,
    note: "Estesa ma debole: soffre molto l’inquinamento luminoso.",
  },
  {
    kind: "dso",
    label: "Nebulosa Laguna",
    catalog: "M8",
    group: "Deep Sky · Nebulose",
    raHours: 18.061,
    decDeg: -24.38,
    priority: 70,
    mag: 6.0,
    difficulty: "media",
    recommendedTool: "binocolo / telescopio",
    bestMonths: [6, 7, 8],
    minUsefulAltitude: 15,
    requiredSunAltitude: -10,
    note: "Bassa dalla Svizzera: serve orizzonte sud libero.",
  },
  {
    kind: "dso",
    label: "Ammasso Anatra Selvatica",
    catalog: "M11",
    group: "Deep Sky · Ammassi aperti",
    raHours: 18.851,
    decDeg: -6.27,
    priority: 76,
    mag: 6.3,
    difficulty: "media",
    recommendedTool: "binocolo / telescopio",
    bestMonths: [7, 8, 9],
    minUsefulAltitude: 20,
    requiredSunAltitude: -10,
    note: "Compatto e ricco; bello con piccolo telescopio.",
  },
  {
    kind: "dso",
    label: "Nebulosa Nord America",
    catalog: "NGC 7000",
    group: "Deep Sky · Nebulose",
    raHours: 20.979,
    decDeg: 44.33,
    priority: 68,
    mag: 4.0,
    difficulty: "difficile",
    recommendedTool: "cielo buio / binocolo largo campo",
    bestMonths: [7, 8, 9, 10],
    minUsefulAltitude: 35,
    requiredSunAltitude: -12,
    note: "Grande ma molto diffusa: difficile senza cielo scuro.",
  },
];

const fmt = (n: number, d = 1) => n.toFixed(d);

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function signedAngularDelta(targetAzimuth: number, heading: number): number {
  const delta = normalizeDeg(targetAzimuth - heading);
  return delta > 180 ? delta - 360 : delta;
}

function absAngularDelta(a: number, b: number): number {
  return Math.abs(signedAngularDelta(a, b));
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function roundDateToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("it-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWindow(w: AdvisorWindow): string {
  return `${formatTime(w.start)}–${formatTime(w.end)}`;
}

function directionLabel(delta: number | null): string {
  if (delta === null) return "—";
  const abs = Math.abs(delta);

  if (abs < 4) return "davanti";
  if (abs < 15) return delta > 0 ? "poco a destra" : "poco a sinistra";
  if (abs < 45) return delta > 0 ? "a destra" : "a sinistra";
  if (abs < 100) return delta > 0 ? "molto a destra" : "molto a sinistra";
  return "dietro / fuori campo";
}

function altitudeQuality(altitude: number): string {
  if (altitude < 0) return "sotto orizzonte";
  if (altitude < 5) return "quasi sull’orizzonte";
  if (altitude < 15) return "basso";
  if (altitude < 35) return "buono";
  if (altitude < 65) return "ottimo";
  return "molto alto";
}

function skyQualityScore(
  altitude: number,
  absDelta: number | null,
  priority: number
): number {
  let score = priority;

  if (altitude < 0) score -= 120;
  else if (altitude < 5) score -= 35;
  else if (altitude < 15) score -= 12;
  else if (altitude < 35) score += 16;
  else score += 28;

  if (absDelta !== null) {
    if (absDelta < 5) score += 40;
    else if (absDelta < 15) score += 25;
    else if (absDelta < 35) score += 12;
    else if (absDelta > 110) score -= 20;
  }

  return score;
}

function computeHeadingJitter(samples: HeadingSample[]): number | null {
  if (samples.length < 4) return null;

  const recent = samples.slice(-10);
  let total = 0;
  let count = 0;

  for (let i = 1; i < recent.length; i++) {
    total += absAngularDelta(recent[i].heading, recent[i - 1].heading);
    count += 1;
  }

  if (count === 0) return null;
  return total / count;
}

function getCalibrationState(params: {
  heading: number | null;
  headingAccuracy: number | null;
  headingJitter: number | null;
  compassMode: CompassMode;
}): CalibrationState {
  const { heading, headingAccuracy, headingJitter, compassMode } = params;

  if (compassMode === "off") {
    return {
      score: 0,
      label: "Bussola non attiva",
      detail: "Attiva la bussola per usare il puntamento reale.",
      reliable: false,
      warning: "La direzione del telefono non è ancora disponibile.",
    };
  }

  if (compassMode === "denied") {
    return {
      score: 0,
      label: "Permesso negato",
      detail: "Abilita i permessi di movimento/orientamento nelle impostazioni.",
      reliable: false,
      warning: "Senza permesso l’app non può leggere la direzione.",
    };
  }

  if (compassMode === "unavailable" || heading === null) {
    return {
      score: 0,
      label: "Bussola non disponibile",
      detail: "Questo browser/dispositivo non sta fornendo dati di orientamento.",
      reliable: false,
      warning: "Prova Safari su iPhone oppure Chrome/Edge su Android.",
    };
  }

  let score = 100;
  const warnings: string[] = [];

  if (compassMode === "relative") {
    score -= 24;
    warnings.push("Orientamento relativo: il Nord potrebbe non essere assoluto.");
  }

  if (headingAccuracy === null) {
    score -= 10;
  } else if (headingAccuracy <= 10) {
    score -= 0;
  } else if (headingAccuracy <= 20) {
    score -= 10;
  } else if (headingAccuracy <= 35) {
    score -= 25;
    warnings.push("Precisione bussola mediocre.");
  } else {
    score -= 45;
    warnings.push("Possibile disturbo magnetico o bussola non calibrata.");
  }

  if (headingJitter !== null) {
    if (headingJitter <= 3) {
      score -= 0;
    } else if (headingJitter <= 8) {
      score -= 8;
    } else if (headingJitter <= 15) {
      score -= 22;
      warnings.push("Direzione instabile: tieni il telefono fermo.");
    } else {
      score -= 38;
      warnings.push("Direzione molto instabile.");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  if (score >= 82) {
    return {
      score,
      label: "Calibrazione buona",
      detail: "Puntamento utilizzabile sul campo.",
      reliable: true,
      warning: warnings[0] ?? null,
    };
  }

  if (score >= 60) {
    return {
      score,
      label: "Calibrazione discreta",
      detail: "Usabile, ma verifica con una stella nota o con la Luna.",
      reliable: true,
      warning: warnings[0] ?? "Precisione non perfetta.",
    };
  }

  if (score >= 35) {
    return {
      score,
      label: "Calibrazione debole",
      detail: "Meglio ricalibrare prima di fidarsi del radar.",
      reliable: false,
      warning:
        warnings[0] ??
        "Muovi il telefono lentamente a forma di 8, lontano da metalli e magneti.",
    };
  }

  return {
    score,
    label: "Calibrazione critica",
    detail: "Il puntamento non è affidabile.",
    reliable: false,
    warning:
      warnings[0] ??
      "Allontanati da auto, ringhiere, casse audio, magneti o cover magnetiche.",
  };
}

function getCalibrationColor(score: number): string {
  if (score >= 82) return "#7CFF9B";
  if (score >= 60) return "#FFE27A";
  if (score >= 35) return "#FFB86B";
  return "#FF6B6B";
}

function safeNumber(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function getAltAz(obj: SkyObject, date: Date, observer: Observer): AltAz | null {
  try {
    let ra: number;
    let dec: number;

    if (obj.kind === "body" && obj.body) {
      const eq = Equator(obj.body, date, observer, true, true);
      ra = eq.ra;
      dec = eq.dec;
    } else if (
      (obj.kind === "star" || obj.kind === "dso") &&
      typeof obj.raHours === "number" &&
      typeof obj.decDeg === "number"
    ) {
      ra = obj.raHours;
      dec = obj.decDeg;
    } else {
      return null;
    }

    const hor = Horizon(date, observer, ra, dec, "normal");

    return {
      altitude: hor.altitude,
      azimuth: normalizeDeg(hor.azimuth),
    };
  } catch {
    return null;
  }
}

function objectRequiresDarkSky(obj: SkyObject): boolean {
  if (obj.kind === "dso") return true;
  if (obj.kind === "star") return true;
  if (obj.label === "Urano" || obj.label === "Nettuno") return true;
  return false;
}

function objectRequiresSunBelowHorizon(obj: SkyObject): boolean {
  if (obj.label === "Sole") return false;
  if (obj.label === "Luna") return false;
  return true;
}

function usefulAltitudeForObject(obj: SkyObject, globalMinAltitude: number): number {
  return Math.max(globalMinAltitude, obj.minUsefulAltitude ?? globalMinAltitude);
}

function requiredSunAltitudeForObject(obj: SkyObject): number {
  if (typeof obj.requiredSunAltitude === "number") return obj.requiredSunAltitude;
  if (obj.kind === "dso") return -10;
  if (obj.kind === "star") return -6;
  if (obj.label === "Urano" || obj.label === "Nettuno") return -8;
  if (objectRequiresSunBelowHorizon(obj)) return 0;
  return 90;
}

function isSampleUsable(params: {
  obj: SkyObject;
  altitude: number;
  sunAltitude: number;
  minUsefulAltitude: number;
}): boolean {
  const { obj, altitude, sunAltitude, minUsefulAltitude } = params;

  if (obj.label === "Sole") {
    return altitude > 0;
  }

  if (altitude < usefulAltitudeForObject(obj, minUsefulAltitude)) {
    return false;
  }

  if (objectRequiresDarkSky(obj)) {
    return sunAltitude < requiredSunAltitudeForObject(obj);
  }

  if (objectRequiresSunBelowHorizon(obj)) {
    return sunAltitude < 0;
  }

  return true;
}

function buildUsefulWindows(samples: AdvisorSample[]): AdvisorWindow[] {
  const windows: AdvisorWindow[] = [];
  let currentStart: Date | null = null;
  let currentEnd: Date | null = null;

  for (const sample of samples) {
    const sampleStart = sample.date;
    const sampleEnd = addMinutes(sample.date, ADVISOR_STEP_MINUTES);

    if (sample.usable) {
      if (!currentStart) currentStart = sampleStart;
      currentEnd = sampleEnd;
    } else {
      if (currentStart && currentEnd) {
        windows.push({
          start: currentStart,
          end: currentEnd,
          minutes: Math.round(
            (currentEnd.getTime() - currentStart.getTime()) / 60_000
          ),
        });
      }
      currentStart = null;
      currentEnd = null;
    }
  }

  if (currentStart && currentEnd) {
    windows.push({
      start: currentStart,
      end: currentEnd,
      minutes: Math.round(
        (currentEnd.getTime() - currentStart.getTime()) / 60_000
      ),
    });
  }

  return windows;
}

function monthName(m: number): string {
  const names = [
    "gen",
    "feb",
    "mar",
    "apr",
    "mag",
    "giu",
    "lug",
    "ago",
    "set",
    "ott",
    "nov",
    "dic",
  ];
  return names[m - 1] ?? `${m}`;
}

function seasonLabel(obj: SkyObject): string {
  if (!obj.bestMonths || obj.bestMonths.length === 0) return "stagione: —";
  return `stagione: ${obj.bestMonths.map(monthName).join(" · ")}`;
}

function seasonBonus(obj: SkyObject, date: Date): number {
  if (!obj.bestMonths || obj.bestMonths.length === 0) return 0;

  const month = date.getMonth() + 1;
  const prevMonth = month === 1 ? 12 : month - 1;
  const nextMonth = month === 12 ? 1 : month + 1;

  if (obj.bestMonths.includes(month)) return 22;
  if (obj.bestMonths.includes(prevMonth) || obj.bestMonths.includes(nextMonth)) {
    return 10;
  }

  return -12;
}

function difficultyBonus(obj: SkyObject): number {
  if (obj.kind !== "dso") return 0;
  if (obj.difficulty === "facile") return 18;
  if (obj.difficulty === "media") return 4;
  if (obj.difficulty === "difficile") return -14;
  return 0;
}

function makeAdviceForObject(params: {
  obj: SkyObject;
  observer: Observer;
  baseTime: Date;
  minUsefulAltitude: number;
}): VisibilityAdvice | null {
  const { obj, observer, baseTime, minUsefulAltitude } = params;

  const current = getAltAz(obj, baseTime, observer);
  const sunObj = SKY_OBJECTS.find((o) => o.label === "Sole");

  if (!current || !sunObj) return null;

  const samples: AdvisorSample[] = [];

  const totalSteps = Math.round(
    (ADVISOR_SCAN_HOURS * 60) / ADVISOR_STEP_MINUTES
  );

  for (let i = 0; i <= totalSteps; i++) {
    const date = addMinutes(baseTime, i * ADVISOR_STEP_MINUTES);
    const altAz = getAltAz(obj, date, observer);
    const sunAltAz = getAltAz(sunObj, date, observer);

    if (!altAz || !sunAltAz) continue;

    const usable = isSampleUsable({
      obj,
      altitude: altAz.altitude,
      sunAltitude: sunAltAz.altitude,
      minUsefulAltitude,
    });

    samples.push({
      date,
      altitude: altAz.altitude,
      azimuth: altAz.azimuth,
      sunAltitude: sunAltAz.altitude,
      usable,
    });
  }

  if (samples.length === 0) return null;

  const usefulWindows = buildUsefulWindows(samples);
  const usefulMinutes = usefulWindows.reduce((sum, w) => sum + w.minutes, 0);

  const bestUsable = samples
    .filter((s) => s.usable)
    .sort((a, b) => b.altitude - a.altitude)[0];

  const bestOverall = [...samples].sort((a, b) => b.altitude - a.altitude)[0];
  const best = bestUsable ?? bestOverall;

  const isCurrentlyUseful = samples[0]?.usable ?? false;

  let status: VisibilityAdvice["status"] = "Non consigliato";
  let reason = "";

  const requiredSun = requiredSunAltitudeForObject(obj);
  const minAlt = usefulAltitudeForObject(obj, minUsefulAltitude);

  if (obj.label === "Sole") {
    status = "Sole";
    reason = "Non osservare direttamente il Sole senza filtri certificati.";
  } else if (isCurrentlyUseful) {
    status = "Ora";
    if (best.date.getTime() > baseTime.getTime() + 20 * 60_000) {
      reason = `Già osservabile. Meglio verso le ${formatTime(best.date)}.`;
    } else {
      reason = "Buono adesso.";
    }
  } else if (usefulWindows.length > 0) {
    status = "Più tardi";
    reason = `Prossima finestra utile: ${formatWindow(usefulWindows[0])}.`;
  } else if (bestOverall.altitude > 0 && bestOverall.altitude < minAlt) {
    status = "Basso";
    reason = `Resta basso: massimo ${fmt(bestOverall.altitude)}° nelle prossime ${ADVISOR_SCAN_HOURS} ore.`;
  } else if (
    bestOverall.altitude >= minAlt &&
    objectRequiresDarkSky(obj) &&
    bestOverall.sunAltitude >= requiredSun
  ) {
    status = "Non consigliato";
    reason = `Serve cielo più buio: Sole sotto ${requiredSun}°.`;
  } else if (
    bestOverall.altitude >= minAlt &&
    objectRequiresSunBelowHorizon(obj) &&
    bestOverall.sunAltitude >= 0
  ) {
    status = "Non consigliato";
    reason = "Sarebbe alto, ma il Sole è ancora sopra l’orizzonte.";
  } else {
    status = "Non consigliato";
    reason = "Non raggiunge condizioni utili nella finestra calcolata.";
  }

  let advisorScore = obj.priority;

  if (obj.label === "Sole") advisorScore -= 80;

  advisorScore += Math.max(0, best.altitude) * 1.25;
  advisorScore += Math.min(60, usefulMinutes / 4);
  advisorScore += seasonBonus(obj, best.date);
  advisorScore += difficultyBonus(obj);

  if (obj.kind === "dso") {
    advisorScore += 15;
    if (typeof obj.mag === "number") {
      advisorScore += Math.max(0, 7 - obj.mag) * 2;
    }
  }

  if (isCurrentlyUseful) advisorScore += 45;
  if (status === "Più tardi") advisorScore += 20;
  if (status === "Basso") advisorScore -= 35;
  if (status === "Non consigliato") advisorScore -= 70;

  return {
    ...obj,
    currentAltitude: current.altitude,
    currentAzimuth: current.azimuth,
    bestTime: best.date,
    bestAltitude: best.altitude,
    bestAzimuth: best.azimuth,
    usefulWindows,
    usefulMinutes,
    status,
    reason,
    advisorScore,
    isCurrentlyUseful,
    seasonLabel: seasonLabel(obj),
  };
}

function getStatusColor(status: VisibilityAdvice["status"]): string {
  if (status === "Ora") return "#7CFF9B";
  if (status === "Più tardi") return "#FFE27A";
  if (status === "Basso") return "#FFB86B";
  if (status === "Sole") return "#FF8A6B";
  return "#AAB3D8";
}

function getKindColor(kind: SkyKind): string {
  if (kind === "dso") return "#7CFFCB";
  if (kind === "star") return "#7CFF9B";
  return "#8c5cff";
}

function App() {
  const [now, setNow] = useState(() => new Date());

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [geoStatus, setGeoStatus] = useState("Posizione non ancora attiva");

  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");

  const [compassMode, setCompassMode] = useState<CompassMode>("off");
  const [rawHeading, setRawHeading] = useState<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [headingJitter, setHeadingJitter] = useState<number | null>(null);
  const [headingOffset, setHeadingOffset] = useState(0);

  const [fieldMode, setFieldMode] = useState(false);
  const [showInvisible, setShowInvisible] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [minUsefulAltitude, setMinUsefulAltitude] = useState(15);
  const [showOnlyDeepSky, setShowOnlyDeepSky] = useState(false);

  const samplesRef = useRef<HeadingSample[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const compassListeningRef = useRef(false);

  const effectiveHeading =
    rawHeading === null ? null : normalizeDeg(rawHeading + headingOffset);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const observer = useMemo(() => {
    if (latitude === null || longitude === null) return null;
    return new Observer(latitude, longitude, 0);
  }, [latitude, longitude]);

  const minuteKey = Math.floor(now.getTime() / 60_000);

  const skyResults = useMemo<SkyResult[]>(() => {
    if (!observer) return [];

    const results: SkyResult[] = [];

    for (const obj of SKY_OBJECTS) {
      const altAz = getAltAz(obj, now, observer);
      if (!altAz) continue;

      const altitude = altAz.altitude;
      const azimuth = altAz.azimuth;
      const visible = altitude > 0;

      const delta =
        effectiveHeading === null
          ? null
          : signedAngularDelta(azimuth, effectiveHeading);

      const absDelta = delta === null ? null : Math.abs(delta);

      const qualityLabel = altitudeQuality(altitude);
      const qualityScore = skyQualityScore(altitude, absDelta, obj.priority);

      results.push({
        ...obj,
        altitude,
        azimuth,
        deltaFromHeading: delta,
        absDeltaFromHeading: absDelta,
        visible,
        qualityLabel,
        qualityScore,
      });
    }

    return results.sort((a, b) => b.qualityScore - a.qualityScore);
  }, [observer, now, effectiveHeading]);

  const advisorResults = useMemo<VisibilityAdvice[]>(() => {
    if (!observer) return [];

    const baseTime = roundDateToMinute(new Date(minuteKey * 60_000));

    return SKY_OBJECTS.map((obj) =>
      makeAdviceForObject({
        obj,
        observer,
        baseTime,
        minUsefulAltitude,
      })
    )
      .filter((x): x is VisibilityAdvice => x !== null)
      .sort((a, b) => b.advisorScore - a.advisorScore);
  }, [observer, minuteKey, minUsefulAltitude]);

  const bestAdvisorResults = useMemo(() => {
    return advisorResults
      .filter((a) => a.label !== "Sole")
      .filter((a) => a.kind !== "dso")
      .slice(0, 8);
  }, [advisorResults]);

  const bestDeepSkyResults = useMemo(() => {
    return advisorResults.filter((a) => a.kind === "dso").slice(0, 10);
  }, [advisorResults]);

  const selectedSkyTarget = useMemo(() => {
    if (!selectedTarget) return null;
    return skyResults.find((r) => r.label === selectedTarget) ?? null;
  }, [selectedTarget, skyResults]);

  const visibleResults = useMemo(() => {
    let base = showInvisible ? skyResults : skyResults.filter((r) => r.visible);
    if (showOnlyDeepSky) base = base.filter((r) => r.kind === "dso");
    return base;
  }, [skyResults, showInvisible, showOnlyDeepSky]);

  const radarResults = useMemo(() => {
    return skyResults
      .filter((r) => r.visible)
      .filter((r) => r.deltaFromHeading !== null)
      .filter((r) => Math.abs(r.deltaFromHeading ?? 999) <= 110)
      .filter((r) => r.altitude > 0)
      .slice(0, 14);
  }, [skyResults]);

  const calibration = useMemo(() => {
    return getCalibrationState({
      heading: effectiveHeading,
      headingAccuracy,
      headingJitter,
      compassMode,
    });
  }, [effectiveHeading, headingAccuracy, headingJitter, compassMode]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setGeoStatus("Geolocalizzazione non supportata");
      return;
    }

    setGeoStatus("Richiesta posizione…");

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setGeoAccuracy(pos.coords.accuracy ?? null);
        setGeoStatus("Posizione attiva");
      },
      (err) => {
        setGeoStatus(`Errore posizione: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      }
    );
  }

  function useManualPosition() {
    const lat = safeNumber(manualLat);
    const lon = safeNumber(manualLon);

    if (lat === null || lon === null) {
      setGeoStatus("Coordinate manuali non valide");
      return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setGeoStatus("Coordinate fuori range");
      return;
    }

    setLatitude(lat);
    setLongitude(lon);
    setGeoAccuracy(null);
    setGeoStatus("Posizione manuale attiva");
  }

  async function requestCompass() {
    const OrientationEventClass = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<"granted" | "denied">;
        })
      | undefined;

    if (!OrientationEventClass) {
      setCompassMode("unavailable");
      return;
    }

    try {
      if (typeof OrientationEventClass.requestPermission === "function") {
        const permission = await OrientationEventClass.requestPermission();

        if (permission !== "granted") {
          setCompassMode("denied");
          return;
        }
      }

      if (!compassListeningRef.current) {
        window.addEventListener(
          "deviceorientationabsolute",
          handleOrientation as EventListener,
          true
        );
        window.addEventListener(
          "deviceorientation",
          handleOrientation as EventListener,
          true
        );
        compassListeningRef.current = true;
      }

      setCompassMode("relative");
    } catch {
      setCompassMode("unavailable");
    }
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const anyEvent = event as DeviceOrientationEvent & {
      webkitCompassHeading?: number;
      webkitCompassAccuracy?: number;
    };

    let nextHeading: number | null = null;
    let nextAccuracy: number | null = null;
    let nextMode: CompassMode = "relative";

    if (typeof anyEvent.webkitCompassHeading === "number") {
      nextHeading = normalizeDeg(anyEvent.webkitCompassHeading);
      nextAccuracy =
        typeof anyEvent.webkitCompassAccuracy === "number"
          ? anyEvent.webkitCompassAccuracy
          : null;
      nextMode = "ios-webkit";
    } else if (event.absolute && typeof event.alpha === "number") {
      nextHeading = normalizeDeg(360 - event.alpha);
      nextAccuracy = null;
      nextMode = "absolute";
    } else if (typeof event.alpha === "number") {
      nextHeading = normalizeDeg(360 - event.alpha);
      nextAccuracy = null;
      nextMode = "relative";
    }

    if (nextHeading === null) {
      setCompassMode("unavailable");
      return;
    }

    const t = Date.now();
    samplesRef.current = [
      ...samplesRef.current,
      {
        t,
        heading: nextHeading,
      },
    ].filter((s) => t - s.t < 4000);

    setRawHeading(nextHeading);
    setHeadingAccuracy(nextAccuracy);
    setHeadingJitter(computeHeadingJitter(samplesRef.current));
    setCompassMode(nextMode);
  }

  function resetCompassOffset() {
    setHeadingOffset(0);
  }

  function markCurrentDirectionAsNorth() {
    if (rawHeading === null) return;
    setHeadingOffset(normalizeDeg(-rawHeading));
  }

  function alignToSelectedTarget() {
    if (!selectedSkyTarget || rawHeading === null) return;
    setHeadingOffset(normalizeDeg(selectedSkyTarget.azimuth - rawHeading));
  }

  const appStyle: CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, #18264a 0%, #0b1020 42%, #05070d 100%)",
    color: "#f4f7ff",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
    padding: fieldMode ? "10px" : "18px",
    boxSizing: "border-box",
  };

  const shellStyle: CSSProperties = {
    maxWidth: 980,
    margin: "0 auto",
    display: "grid",
    gap: fieldMode ? 10 : 16,
  };

  const cardStyle: CSSProperties = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 22,
    padding: fieldMode ? 14 : 18,
    boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
    backdropFilter: "blur(14px)",
  };

  const buttonStyle: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 14,
    padding: "11px 14px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  };

  const primaryButtonStyle: CSSProperties = {
    ...buttonStyle,
    background: "linear-gradient(135deg, #5877ff, #8c5cff)",
    border: "none",
  };

  const smallButtonStyle: CSSProperties = {
    ...buttonStyle,
    padding: "8px 10px",
    fontSize: 13,
    borderRadius: 12,
  };

  const mutedStyle: CSSProperties = {
    color: "rgba(244,247,255,0.68)",
  };

  const calibrationColor = getCalibrationColor(calibration.score);

  return (
    <main style={appStyle}>
      <section style={shellStyle}>
        <header
          style={{
            display: "grid",
            gap: 8,
            paddingTop: "env(safe-area-inset-top)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: fieldMode ? 25 : 31,
                  lineHeight: 1.05,
                }}
              >
                Sky Field
              </h1>
              <p style={{ ...mutedStyle, margin: "6px 0 0" }}>
                V6.7 — Deep Sky Objects
              </p>
            </div>

            <button
              style={fieldMode ? primaryButtonStyle : buttonStyle}
              onClick={() => setFieldMode((v) => !v)}
            >
              {fieldMode ? "Field ON" : "Field Mode"}
            </button>
          </div>

          {fieldMode && (
            <div
              style={{
                borderRadius: 18,
                padding: "12px 14px",
                background: calibration.reliable
                  ? "rgba(124,255,155,0.12)"
                  : "rgba(255,107,107,0.14)",
                border: `1px solid ${calibrationColor}`,
              }}
            >
              <strong style={{ color: calibrationColor }}>
                {calibration.label} — {calibration.score}/100
              </strong>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                {calibration.warning ?? calibration.detail}
              </div>
            </div>
          )}
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: fieldMode ? "1fr" : "repeat(2, minmax(0, 1fr))",
            gap: fieldMode ? 10 : 16,
          }}
        >
          <div style={cardStyle}>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Base</h2>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button style={primaryButtonStyle} onClick={requestLocation}>
                Attiva posizione
              </button>
              <button style={primaryButtonStyle} onClick={requestCompass}>
                Attiva bussola
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gap: 7,
                marginTop: 14,
                fontSize: 14,
              }}
            >
              <div>
                <strong>Posizione:</strong>{" "}
                <span style={mutedStyle}>{geoStatus}</span>
              </div>

              <div>
                <strong>Coordinate:</strong>{" "}
                {latitude !== null && longitude !== null ? (
                  <span>
                    {fmt(latitude, 5)}, {fmt(longitude, 5)}
                  </span>
                ) : (
                  <span style={mutedStyle}>—</span>
                )}
              </div>

              <div>
                <strong>Accuratezza GPS:</strong>{" "}
                {geoAccuracy !== null ? (
                  <span>{fmt(geoAccuracy, 0)} m</span>
                ) : (
                  <span style={mutedStyle}>—</span>
                )}
              </div>

              <div>
                <strong>Ora:</strong>{" "}
                <span>{now.toLocaleTimeString("it-CH")}</span>
              </div>
            </div>

            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", color: "#dce4ff" }}>
                Coordinate manuali
              </summary>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <input
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="Latitudine"
                  inputMode="decimal"
                  style={inputStyle}
                />
                <input
                  value={manualLon}
                  onChange={(e) => setManualLon(e.target.value)}
                  placeholder="Longitudine"
                  inputMode="decimal"
                  style={inputStyle}
                />
              </div>

              <button
                style={{ ...smallButtonStyle, marginTop: 10 }}
                onClick={useManualPosition}
              >
                Usa coordinate manuali
              </button>
            </details>
          </div>

          <div style={cardStyle}>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>
              Calibration Pro
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "76px 1fr",
                gap: 14,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  border: `5px solid ${calibrationColor}`,
                  color: calibrationColor,
                  fontWeight: 900,
                  fontSize: 20,
                  background: "rgba(0,0,0,0.2)",
                }}
              >
                {calibration.score}
              </div>

              <div>
                <strong style={{ color: calibrationColor }}>
                  {calibration.label}
                </strong>
                <p style={{ ...mutedStyle, margin: "5px 0 0" }}>
                  {calibration.detail}
                </p>
              </div>
            </div>

            {calibration.warning && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 15,
                  background: "rgba(255,184,107,0.12)",
                  border: "1px solid rgba(255,184,107,0.35)",
                }}
              >
                {calibration.warning}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gap: 7,
                marginTop: 14,
                fontSize: 14,
              }}
            >
              <div>
                <strong>Heading grezzo:</strong>{" "}
                {rawHeading !== null ? `${fmt(rawHeading)}°` : "—"}
              </div>

              <div>
                <strong>Heading corretto:</strong>{" "}
                {effectiveHeading !== null ? `${fmt(effectiveHeading)}°` : "—"}
              </div>

              <div>
                <strong>Offset manuale:</strong> {fmt(headingOffset)}°
              </div>

              <div>
                <strong>Precisione bussola:</strong>{" "}
                {headingAccuracy !== null ? `${fmt(headingAccuracy)}°` : "—"}
              </div>

              <div>
                <strong>Instabilità:</strong>{" "}
                {headingJitter !== null ? `${fmt(headingJitter)}°` : "—"}
              </div>

              <div>
                <strong>Modo sensore:</strong>{" "}
                <span style={mutedStyle}>{compassMode}</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 14,
              }}
            >
              <button style={smallButtonStyle} onClick={resetCompassOffset}>
                Reset offset
              </button>

              <button
                style={smallButtonStyle}
                onClick={() => setHeadingOffset((v) => normalizeDeg(v - 5))}
              >
                -5°
              </button>

              <button
                style={smallButtonStyle}
                onClick={() => setHeadingOffset((v) => normalizeDeg(v + 5))}
              >
                +5°
              </button>

              <button
                style={smallButtonStyle}
                disabled={rawHeading === null}
                onClick={markCurrentDirectionAsNorth}
              >
                Sto puntando Nord
              </button>
            </div>

            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 16,
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <strong>Calibrazione su oggetto reale</strong>
              <p style={{ ...mutedStyle, margin: "6px 0 10px" }}>
                Punta fisicamente il telefono verso Luna, Venere, una stella o
                un oggetto riconoscibile e premi “Allinea”.
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  style={smallButtonStyle}
                  disabled={!selectedSkyTarget || rawHeading === null}
                  onClick={alignToSelectedTarget}
                >
                  Allinea a{" "}
                  {selectedSkyTarget ? selectedSkyTarget.label : "target"}
                </button>

                {selectedSkyTarget && (
                  <span style={{ ...mutedStyle, alignSelf: "center" }}>
                    Target: {selectedSkyTarget.label} — Az{" "}
                    {fmt(selectedSkyTarget.azimuth)}°
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Deep Sky consigliati</h2>
              <p style={{ ...mutedStyle, margin: "5px 0 0" }}>
                Oggetti estesi o deboli filtrati per buio, altezza e stagione.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 7,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {[10, 15, 20, 25].map((alt) => (
                <button
                  key={alt}
                  style={{
                    ...smallButtonStyle,
                    background:
                      minUsefulAltitude === alt
                        ? "rgba(255,255,255,0.28)"
                        : smallButtonStyle.background,
                  }}
                  onClick={() => setMinUsefulAltitude(alt)}
                >
                  min {alt}°
                </button>
              ))}
            </div>
          </div>

          {bestDeepSkyResults.length === 0 && (
            <div style={mutedStyle}>
              Attiva la posizione per calcolare gli oggetti deep-sky.
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {bestDeepSkyResults.map((item) => {
              const color = getStatusColor(item.status);
              const firstWindow = item.usefulWindows[0];

              return (
                <article
                  key={item.label}
                  style={{
                    display: "grid",
                    gap: 9,
                    padding: fieldMode ? 14 : 12,
                    borderRadius: 18,
                    border: "1px solid rgba(124,255,203,0.24)",
                    background: "rgba(124,255,203,0.07)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: fieldMode ? 20 : 17 }}>
                        {item.label}
                      </strong>
                      {item.catalog && (
                        <span
                          style={{
                            ...mutedStyle,
                            marginLeft: 8,
                            fontSize: 13,
                          }}
                        >
                          {item.catalog}
                        </span>
                      )}
                    </div>

                    <span
                      style={{
                        color,
                        fontWeight: 900,
                        fontSize: fieldMode ? 16 : 14,
                      }}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div style={{ color: "#dce4ff" }}>{item.reason}</div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px 13px",
                      fontSize: fieldMode ? 15 : 14,
                    }}
                  >
                    <span>Ora: {fmt(item.currentAltitude)}°</span>
                    <span>
                      Meglio: {formatTime(item.bestTime)} ·{" "}
                      {fmt(item.bestAltitude)}°
                    </span>
                    <span>Az: {fmt(item.bestAzimuth)}°</span>
                    {typeof item.mag === "number" && (
                      <span>mag {item.mag}</span>
                    )}
                    {item.difficulty && <span>{item.difficulty}</span>}
                    {item.recommendedTool && <span>{item.recommendedTool}</span>}
                    {firstWindow && <span>Finestra: {formatWindow(firstWindow)}</span>}
                  </div>

                  <div style={{ ...mutedStyle, fontSize: 13 }}>
                    {item.seasonLabel}
                    {item.note ? ` · ${item.note}` : ""}
                  </div>

                  <div>
                    <button
                      style={smallButtonStyle}
                      onClick={() => setSelectedTarget(item.label)}
                    >
                      Usa come target
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Visibility Advisor</h2>
              <p style={{ ...mutedStyle, margin: "5px 0 0" }}>
                Ranking osservativo per pianeti e stelle nelle prossime{" "}
                {ADVISOR_SCAN_HOURS} ore.
              </p>
            </div>
          </div>

          {bestAdvisorResults.length === 0 && (
            <div style={mutedStyle}>
              Attiva la posizione per calcolare le finestre di osservazione.
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {bestAdvisorResults.map((item) => {
              const color = getStatusColor(item.status);
              const firstWindow = item.usefulWindows[0];

              return (
                <article
                  key={item.label}
                  style={{
                    display: "grid",
                    gap: 9,
                    padding: fieldMode ? 14 : 12,
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.065)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: fieldMode ? 20 : 17 }}>
                        {item.label}
                      </strong>
                      <span
                        style={{
                          ...mutedStyle,
                          marginLeft: 8,
                          fontSize: 13,
                        }}
                      >
                        {item.group}
                      </span>
                    </div>

                    <span
                      style={{
                        color,
                        fontWeight: 900,
                        fontSize: fieldMode ? 16 : 14,
                      }}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div style={{ color: "#dce4ff" }}>{item.reason}</div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px 13px",
                      fontSize: fieldMode ? 15 : 14,
                    }}
                  >
                    <span>Ora: {fmt(item.currentAltitude)}°</span>
                    <span>
                      Meglio: {formatTime(item.bestTime)} ·{" "}
                      {fmt(item.bestAltitude)}°
                    </span>
                    <span>Az: {fmt(item.bestAzimuth)}°</span>
                    {firstWindow && <span>Finestra: {formatWindow(firstWindow)}</span>}
                  </div>

                  <div>
                    <button
                      style={smallButtonStyle}
                      onClick={() => setSelectedTarget(item.label)}
                    >
                      Usa come target
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Radar compatto</h2>
              <p style={{ ...mutedStyle, margin: "5px 0 0" }}>
                Oggetti visibili entro circa 110° dalla direzione del telefono.
              </p>
            </div>

            <div
              style={{
                fontSize: 24,
                fontWeight: 900,
                color: calibrationColor,
                whiteSpace: "nowrap",
              }}
            >
              {effectiveHeading !== null ? `${fmt(effectiveHeading, 0)}°` : "—"}
            </div>
          </div>

          <div style={radarBoxStyle}>
            <div style={radarVerticalLineStyle} />
            <div style={radarHorizontalLineStyle} />
            <div style={radarForwardStyle}>DAVANTI</div>

            {radarResults.map((obj) => {
              const delta = obj.deltaFromHeading ?? 0;
              const x = 50 + (delta / 110) * 45;
              const y = 88 - Math.min(82, Math.max(0, obj.altitude));
              const isSelected = selectedTarget === obj.label;

              return (
                <button
                  key={obj.label}
                  onClick={() => setSelectedTarget(obj.label)}
                  title={obj.label}
                  style={{
                    position: "absolute",
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: "translate(-50%, -50%)",
                    border: isSelected
                      ? "2px solid #fff"
                      : "1px solid rgba(255,255,255,0.35)",
                    background: getKindColor(obj.kind),
                    color: "#07101e",
                    borderRadius: 999,
                    padding: fieldMode ? "7px 9px" : "5px 8px",
                    fontSize: fieldMode ? 13 : 11,
                    fontWeight: 900,
                    cursor: "pointer",
                    boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
                    maxWidth: 130,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {obj.catalog ?? obj.label}
                </button>
              );
            })}

            {radarResults.length === 0 && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  color: "rgba(244,247,255,0.62)",
                  textAlign: "center",
                  padding: 20,
                }}
              >
                Attiva posizione e bussola.
                <br />
                Se non compare nulla, ruota lentamente il telefono.
              </div>
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Oggetti</h2>
              <p style={{ ...mutedStyle, margin: "5px 0 0" }}>
                Catalogo ordinato per visibilità, altezza e vicinanza alla
                direzione di puntamento.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                style={{
                  ...smallButtonStyle,
                  background: showOnlyDeepSky
                    ? "rgba(124,255,203,0.22)"
                    : smallButtonStyle.background,
                }}
                onClick={() => setShowOnlyDeepSky((v) => !v)}
              >
                {showOnlyDeepSky ? "Tutti" : "Solo Deep Sky"}
              </button>

              <button
                style={smallButtonStyle}
                onClick={() => setShowInvisible((v) => !v)}
              >
                {showInvisible ? "Solo visibili" : "Mostra tutti"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {visibleResults.length === 0 && (
              <div style={{ ...mutedStyle }}>
                Nessun oggetto calcolabile: attiva prima la posizione.
              </div>
            )}

            {visibleResults.map((obj) => {
              const isSelected = selectedTarget === obj.label;

              return (
                <article
                  key={obj.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: fieldMode ? "1fr" : "1fr auto",
                    gap: 10,
                    padding: fieldMode ? 14 : 12,
                    borderRadius: 18,
                    border: isSelected
                      ? "1px solid rgba(255,255,255,0.9)"
                      : "1px solid rgba(255,255,255,0.12)",
                    background:
                      obj.kind === "dso"
                        ? "rgba(124,255,203,0.055)"
                        : obj.visible
                          ? "rgba(255,255,255,0.07)"
                          : "rgba(255,255,255,0.035)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        alignItems: "baseline",
                      }}
                    >
                      <strong style={{ fontSize: fieldMode ? 20 : 17 }}>
                        {obj.label}
                      </strong>

                      {obj.catalog && (
                        <span style={{ ...mutedStyle, fontSize: 13 }}>
                          {obj.catalog}
                        </span>
                      )}

                      <span style={{ ...mutedStyle, fontSize: 13 }}>
                        {obj.group}
                      </span>

                      {typeof obj.mag === "number" && (
                        <span style={{ ...mutedStyle, fontSize: 13 }}>
                          mag {obj.mag}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px 13px",
                        marginTop: 8,
                        fontSize: fieldMode ? 15 : 14,
                      }}
                    >
                      <span>Alt {fmt(obj.altitude)}°</span>
                      <span>Az {fmt(obj.azimuth)}°</span>
                      <span>{obj.qualityLabel}</span>
                      {obj.difficulty && <span>{obj.difficulty}</span>}
                      {obj.recommendedTool && <span>{obj.recommendedTool}</span>}
                      <span>
                        {obj.deltaFromHeading !== null
                          ? `${directionLabel(obj.deltaFromHeading)} · ${fmt(
                              obj.deltaFromHeading
                            )}°`
                          : "direzione telefono non attiva"}
                      </span>
                    </div>

                    {obj.note && (
                      <div style={{ ...mutedStyle, marginTop: 7, fontSize: 13 }}>
                        {seasonLabel(obj)} · {obj.note}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      justifyContent: fieldMode ? "flex-start" : "flex-end",
                    }}
                  >
                    <button
                      style={{
                        ...smallButtonStyle,
                        background: isSelected
                          ? "rgba(255,255,255,0.28)"
                          : smallButtonStyle.background,
                      }}
                      onClick={() => setSelectedTarget(obj.label)}
                    >
                      Target
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>
            Note pratiche Deep Sky
          </h2>

          <div style={{ display: "grid", gap: 8, color: "#dce4ff" }}>
            <div>
              1. Per oggetti deep-sky l’altezza non basta: serve anche buio
              reale. Le galassie e le nebulose diffuse soffrono moltissimo la
              luce urbana.
            </div>
            <div>
              2. Le Pleiadi, Andromeda, Orione, Presepe e Doppio Ammasso sono i
              primi oggetti “facili” da usare per imparare il cielo.
            </div>
            <div>
              3. M57, M13, M33 e NGC 7000 sono più selettivi: spesso serve
              telescopio, cielo scuro o esperienza.
            </div>
            <div>
              4. Il radar ti porta in zona, ma per il deep-sky devi poi usare
              riconoscimento stellare, binocolo o cercatore.
            </div>
            <div>
              5. Se la Luna è molto luminosa, molti oggetti deep-sky diventano
              peggiori anche se l’app li calcola geometricamente visibili.
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(0,0,0,0.22)",
  color: "#fff",
  padding: "11px 12px",
  fontSize: 15,
  outline: "none",
};

const radarBoxStyle: CSSProperties = {
  position: "relative",
  height: 285,
  borderRadius: 24,
  overflow: "hidden",
  background:
    "radial-gradient(circle at 50% 90%, rgba(88,119,255,0.28) 0%, rgba(255,255,255,0.08) 45%, rgba(0,0,0,0.20) 100%)",
  border: "1px solid rgba(255,255,255,0.14)",
};

const radarVerticalLineStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: 0,
  bottom: 0,
  width: 1,
  background: "rgba(255,255,255,0.22)",
};

const radarHorizontalLineStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: "18%",
  height: 1,
  background: "rgba(255,255,255,0.18)",
};

const radarForwardStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 12,
  transform: "translateX(-50%)",
  fontSize: 12,
  letterSpacing: 1.4,
  color: "rgba(244,247,255,0.62)",
  fontWeight: 900,
};

export default App;