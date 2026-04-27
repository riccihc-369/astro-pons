import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Body, Equator, Horizon, Observer } from "astronomy-engine";

type SkyBody = {
  body: Body;
  label: string;
};

type AimMode = "telescope" | "skyfinder" | "field" | "camera";

type StatusKind = "good" | "medium" | "bad" | "solar";

type Observability = {
  observationLabel: string;
  observationScore: number;
  observationReason: string;
  observableNow: boolean;
  guideAllowed: boolean;
  calibrationAllowed: boolean;
  statusKind: StatusKind;
};

type BodyRow = {
  id: string;
  label: string;
  azimuth: number;
  altitude: number;
  visible: boolean;
} & Observability;

type GpsState = {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  error: string | null;
};

type OrientationState = {
  enabled: boolean;
  rawHeading: number | null;
  smoothHeading: number | null;
  beta: number | null;
  gamma: number | null;
  deviceAltitude: number | null;
  error: string | null;
};

type ObservationItem = {
  id: string;
  label: string;
  currentLabel: string;
  currentReason: string;
  currentAltitude: number | null;
  firstUsefulTime: string | null;
  bestTime: string | null;
  bestAltitude: number;
  score: number;
  rating: string;
  advice: string;
  statusKind: StatusKind;
  hasUsefulWindow: boolean;
};

type RadarPoint = {
  x: number;
  y: number;
};

const OFFSET_KEY = "astroPons.compassOffsetDeg";
const AIM_MODE_KEY = "astroPons.aimMode";
const SELECTED_TARGET_KEY = "astroPons.selectedTarget";

function isAimMode(value: string | null): value is AimMode {
  return (
    value === "telescope" ||
    value === "skyfinder" ||
    value === "field" ||
    value === "camera"
  );
}

function readStoredAimMode(): AimMode {
  try {
    const saved = localStorage.getItem(AIM_MODE_KEY);
    return isAimMode(saved) ? saved : "field";
  } catch {
    return "field";
  }
}

function readStoredSelectedTarget(): string {
  try {
    return localStorage.getItem(SELECTED_TARGET_KEY) || "Luna";
  } catch {
    return "Luna";
  }
}
const FORECAST_HOURS = 12;
const FORECAST_STEP_MINUTES = 15;

const POINTER_AXIS =
  "Asse di puntamento affidabile = lato corto superiore dell’iPhone.";

const SKY_BODIES: SkyBody[] = [
  { body: Body.Sun, label: "Sole" },
  { body: Body.Moon, label: "Luna" },
  { body: Body.Mercury, label: "Mercurio" },
  { body: Body.Venus, label: "Venere" },
  { body: Body.Mars, label: "Marte" },
  { body: Body.Jupiter, label: "Giove" },
  { body: Body.Saturn, label: "Saturno" },
];

function normalize360(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalize180(value: number): number {
  const normalized = normalize360(value);
  return normalized > 180 ? normalized - 360 : normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function circularMeanDeg(values: number[]): number | null {
  if (values.length === 0) return null;

  let sinSum = 0;
  let cosSum = 0;

  for (const deg of values) {
    const rad = (deg * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }

  const meanRad = Math.atan2(sinSum / values.length, cosSum / values.length);
  return normalize360((meanRad * 180) / Math.PI);
}

function estimateDeviceAltitude(beta: number | null): number | null {
  if (beta === null || !Number.isFinite(beta)) return null;
  return clamp(90 - beta, -90, 90);
}

function formatDeg(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}°`;
}

function formatTime(date: Date | null): string | null {
  if (!date) return null;

  return date.toLocaleTimeString("it-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function directionText(deltaAz: number | null): string {
  if (deltaAz === null) return "Guida non disponibile";
  if (Math.abs(deltaAz) <= 1.5) return "Azimut centrato";
  return deltaAz > 0 ? "Ruota a destra →" : "← Ruota a sinistra";
}

function altitudeText(deltaAlt: number | null): string {
  if (deltaAlt === null) return "Altezza non disponibile";
  if (Math.abs(deltaAlt) <= 2.0) return "Altezza centrata";
  return deltaAlt > 0 ? "Alza ↑" : "Abbassa ↓";
}

function azimuthToCompass(azimuth: number | null): string {
  if (azimuth === null || !Number.isFinite(azimuth)) return "—";

  const dirs = [
    "Nord",
    "Nord-Nord-Est",
    "Nord-Est",
    "Est-Nord-Est",
    "Est",
    "Est-Sud-Est",
    "Sud-Est",
    "Sud-Sud-Est",
    "Sud",
    "Sud-Sud-Ovest",
    "Sud-Ovest",
    "Ovest-Sud-Ovest",
    "Ovest",
    "Ovest-Nord-Ovest",
    "Nord-Ovest",
    "Nord-Nord-Ovest",
  ];

  const index = Math.round(normalize360(azimuth) / 22.5) % 16;
  return dirs[index];
}

function altitudeBand(altitude: number | null): string {
  if (altitude === null || !Number.isFinite(altitude)) return "—";
  if (altitude < 0) return "sotto";
  if (altitude < 10) return "bassissima";
  if (altitude < 25) return "bassa";
  if (altitude < 45) return "media";
  if (altitude < 65) return "alta";
  return "molto alta";
}

function fieldAltitudeBand(altitude: number | null): string {
  if (altitude === null || !Number.isFinite(altitude)) return "—";
  if (altitude < 0) return "SOTTO";
  if (altitude < 10) return "BASSISSIMA";
  if (altitude < 25) return "BASSA";
  if (altitude < 45) return "MEDIA";
  if (altitude < 65) return "ALTA";
  return "MOLTO ALTA";
}

function statusColorValue(kind: StatusKind | undefined): string {
  if (kind === "good") return "#15ff31";
  if (kind === "medium") return "#ffd400";
  if (kind === "solar") return "#ff9966";
  return "#ff6666";
}

function radarPointFromAzAlt(
  azimuth: number | null,
  altitude: number | null
): RadarPoint | null {
  if (
    azimuth === null ||
    altitude === null ||
    !Number.isFinite(azimuth) ||
    !Number.isFinite(altitude)
  ) {
    return null;
  }

  const safeAltitude = clamp(altitude, 0, 90);
  const radius = 43 * (1 - safeAltitude / 90);
  const rad = (normalize360(azimuth) * Math.PI) / 180;

  return {
    x: 50 + Math.sin(rad) * radius,
    y: 50 - Math.cos(rad) * radius,
  };
}

function skyFinderTurnText(
  target: BodyRow | null,
  correctedHeading: number | null
): string {
  if (!target) return "Target non disponibile.";

  if (!target.observableNow) {
    return "Non cercarlo ora: usa la prima finestra utile indicata sotto.";
  }

  if (correctedHeading === null) {
    return "Attiva la bussola per sapere dove punta il lato corto superiore dell’iPhone.";
  }

  const delta = normalize180(target.azimuth - correctedHeading);

  if (Math.abs(delta) <= 8) {
    return "Il lato corto superiore dell’iPhone è orientato nella zona giusta. Ora cerca alla quota indicata.";
  }

  if (delta > 0) {
    return `Ruota verso destra di circa ${Math.abs(delta).toFixed(0)}°.`;
  }

  return `Ruota verso sinistra di circa ${Math.abs(delta).toFixed(0)}°.`;
}

function fieldTurnShort(
  target: BodyRow | null,
  correctedHeading: number | null
): string {
  if (!target) return "TARGET NON DISPONIBILE";

  if (!target.observableNow) {
    return "NON CERCARLO ORA";
  }

  if (correctedHeading === null) {
    return "ATTIVA BUSSOLA";
  }

  const delta = normalize180(target.azimuth - correctedHeading);

  if (Math.abs(delta) <= 8) {
    return "DIREZIONE OK";
  }

  if (delta > 0) {
    return `DESTRA ${Math.abs(delta).toFixed(0)}°`;
  }

  return `SINISTRA ${Math.abs(delta).toFixed(0)}°`;
}

function analyzeObservability(
  label: string,
  altitude: number,
  sunAltitude: number
): Observability {
  const aboveHorizon = altitude > 0;

  if (label === "Sole") {
    if (aboveHorizon) {
      return {
        observationLabel: "Dato solare",
        observationScore: 5,
        observationReason:
          "Sole sopra l’orizzonte: disponibile solo come dato astronomico. Non usare guida, AR o telescopio senza filtro solare certificato.",
        observableNow: false,
        guideAllowed: false,
        calibrationAllowed: false,
        statusKind: "solar",
      };
    }

    return {
      observationLabel: "Sotto",
      observationScore: 0,
      observationReason: "Sole sotto l’orizzonte.",
      observableNow: false,
      guideAllowed: false,
      calibrationAllowed: false,
      statusKind: "bad",
    };
  }

  if (!aboveHorizon) {
    return {
      observationLabel: "Sotto",
      observationScore: 0,
      observationReason: `${label} è sotto l’orizzonte.`,
      observableNow: false,
      guideAllowed: false,
      calibrationAllowed: false,
      statusKind: "bad",
    };
  }

  if (altitude < 8) {
    return {
      observationLabel: "Troppo basso",
      observationScore: 10,
      observationReason: `${label} è sopra l’orizzonte ma troppo basso: ostacoli, foschia e montagne probabili.`,
      observableNow: false,
      guideAllowed: false,
      calibrationAllowed: false,
      statusKind: "bad",
    };
  }

  if (sunAltitude > -6) {
    if (label === "Luna") {
      if (altitude >= 20) {
        return {
          observationLabel: "Possibile",
          observationScore: 45,
          observationReason:
            "Luna potenzialmente visibile anche di giorno se il contrasto è sufficiente.",
          observableNow: true,
          guideAllowed: true,
          calibrationAllowed: true,
          statusKind: "medium",
        };
      }

      return {
        observationLabel: "Difficile",
        observationScore: 20,
        observationReason:
          "Luna sopra l’orizzonte ma bassa o poco contrastata in cielo diurno.",
        observableNow: false,
        guideAllowed: false,
        calibrationAllowed: false,
        statusKind: "bad",
      };
    }

    if (label === "Venere" && altitude >= 25) {
      return {
        observationLabel: "Difficile",
        observationScore: 25,
        observationReason:
          "Venere può essere teoricamente individuabile di giorno, ma è difficile e non consigliata per calibrazione.",
        observableNow: false,
        guideAllowed: false,
        calibrationAllowed: false,
        statusKind: "medium",
      };
    }

    return {
      observationLabel: "Non ora",
      observationScore: 0,
      observationReason:
        "Corpo sopra l’orizzonte, ma il cielo è troppo luminoso: non osservabile a occhio nudo ora.",
      observableNow: false,
      guideAllowed: false,
      calibrationAllowed: false,
      statusKind: "bad",
    };
  }

  if (sunAltitude > -12) {
    if (label === "Luna" || label === "Venere" || label === "Giove") {
      if (altitude >= 30) {
        return {
          observationLabel: "Buono",
          observationScore: 70,
          observationReason: `${label} è un buon target nel crepuscolo.`,
          observableNow: true,
          guideAllowed: true,
          calibrationAllowed: true,
          statusKind: "good",
        };
      }

      if (altitude >= 15) {
        return {
          observationLabel: "Possibile",
          observationScore: 50,
          observationReason: `${label} è possibile, ma ancora non ideale.`,
          observableNow: true,
          guideAllowed: true,
          calibrationAllowed: true,
          statusKind: "medium",
        };
      }

      return {
        observationLabel: "Basso",
        observationScore: 20,
        observationReason: `${label} è basso nel crepuscolo: attendere se sta salendo.`,
        observableNow: false,
        guideAllowed: false,
        calibrationAllowed: false,
        statusKind: "bad",
      };
    }

    if (altitude >= 30) {
      return {
        observationLabel: "Difficile",
        observationScore: 35,
        observationReason: `${label} sopra l’orizzonte, ma il cielo è ancora troppo chiaro per una buona osservazione.`,
        observableNow: false,
        guideAllowed: false,
        calibrationAllowed: false,
        statusKind: "medium",
      };
    }

    return {
      observationLabel: "Non ora",
      observationScore: 0,
      observationReason: `${label} non è ancora realisticamente osservabile.`,
      observableNow: false,
      guideAllowed: false,
      calibrationAllowed: false,
      statusKind: "bad",
    };
  }

  if (altitude >= 55) {
    return {
      observationLabel: "Ottimo",
      observationScore: 100,
      observationReason: `${label} è alto/a: target molto favorevole.`,
      observableNow: true,
      guideAllowed: true,
      calibrationAllowed: true,
      statusKind: "good",
    };
  }

  if (altitude >= 35) {
    return {
      observationLabel: "Buono",
      observationScore: 85,
      observationReason: `${label} è ben posizionato/a per osservazione.`,
      observableNow: true,
      guideAllowed: true,
      calibrationAllowed: true,
      statusKind: "good",
    };
  }

  if (altitude >= 20) {
    return {
      observationLabel: "Osservabile",
      observationScore: 70,
      observationReason: `${label} è osservabile, anche se non altissimo/a.`,
      observableNow: true,
      guideAllowed: true,
      calibrationAllowed: true,
      statusKind: "good",
    };
  }

  if (altitude >= 10) {
    return {
      observationLabel: "Basso",
      observationScore: 45,
      observationReason: `${label} è osservabile ma basso/a: possibili ostacoli e turbolenza.`,
      observableNow: true,
      guideAllowed: true,
      calibrationAllowed: true,
      statusKind: "medium",
    };
  }

  return {
    observationLabel: "Troppo basso",
    observationScore: 10,
    observationReason: `${label} è troppo basso/a per una buona osservazione.`,
    observableNow: false,
    guideAllowed: false,
    calibrationAllowed: false,
    statusKind: "bad",
  };
}

function buildObservationPlan(
  lat: number,
  lon: number,
  rows: BodyRow[]
): ObservationItem[] {
  const observer = new Observer(lat, lon, 0);
  const now = new Date();

  return SKY_BODIES.map(({ body, label }) => {
    let bestAltitude = -90;
    let bestDate: Date | null = null;
    let bestAnalysis: Observability | null = null;
    let firstUsefulDate: Date | null = null;

    const currentRow = rows.find((row) => row.label === label);
    const currentAnalysis =
      currentRow ??
      ({
        observationLabel: "—",
        observationScore: 0,
        observationReason: "Dati attuali non ancora disponibili.",
        observableNow: false,
        guideAllowed: false,
        calibrationAllowed: false,
        statusKind: "bad",
      } as BodyRow);

    const steps = Math.floor((FORECAST_HOURS * 60) / FORECAST_STEP_MINUTES);

    for (let i = 0; i <= steps; i += 1) {
      const t = new Date(now.getTime() + i * FORECAST_STEP_MINUTES * 60 * 1000);

      const eq = Equator(body, t, observer, true, true);
      const hor = Horizon(t, observer, eq.ra, eq.dec, "normal");

      const sunEq = Equator(Body.Sun, t, observer, true, true);
      const sunHor = Horizon(t, observer, sunEq.ra, sunEq.dec, "normal");

      const analysis = analyzeObservability(label, hor.altitude, sunHor.altitude);

      if (analysis.observableNow && firstUsefulDate === null) {
        firstUsefulDate = t;
      }

      const isBetter =
        bestAnalysis === null ||
        analysis.observationScore > bestAnalysis.observationScore ||
        (analysis.observationScore === bestAnalysis.observationScore &&
          hor.altitude > bestAltitude);

      if (isBetter) {
        bestAnalysis = analysis;
        bestAltitude = hor.altitude;
        bestDate = t;
      }
    }

    const finalBestAnalysis =
      bestAnalysis ??
      analyzeObservability(
        label,
        bestAltitude,
        rows.find((r) => r.id === "Sole")?.altitude ?? 90
      );

    const firstUsefulTime = formatTime(firstUsefulDate);
    const bestTime = formatTime(bestDate);

    let advice: string;

    if (label === "Sole") {
      advice = finalBestAnalysis.observationReason;
    } else if (currentRow?.observableNow) {
      advice = `${label} è osservabile ora. Momento migliore: ${
        bestTime ?? "—"
      }.`;
    } else if (firstUsefulTime) {
      advice = `${label} non è osservabile ora. Prima finestra utile: ${firstUsefulTime}. Momento migliore: ${
        bestTime ?? "—"
      }.`;
    } else {
      advice = `Nessuna finestra utile nelle prossime ${FORECAST_HOURS} ore. ${currentAnalysis.observationReason}`;
    }

    return {
      id: label,
      label,
      currentLabel: currentAnalysis.observationLabel,
      currentReason: currentAnalysis.observationReason,
      currentAltitude: currentRow?.altitude ?? null,
      firstUsefulTime,
      bestTime,
      bestAltitude,
      score: finalBestAnalysis.observationScore,
      rating: finalBestAnalysis.observationLabel,
      advice,
      statusKind: finalBestAnalysis.statusKind,
      hasUsefulWindow: firstUsefulDate !== null,
    };
  }).sort((a, b) => {
    if (a.id === "Sole" && b.id !== "Sole") return 1;
    if (b.id === "Sole" && a.id !== "Sole") return -1;

    if (a.hasUsefulWindow && !b.hasUsefulWindow) return -1;
    if (b.hasUsefulWindow && !a.hasUsefulWindow) return 1;

    return b.score - a.score;
  });
}

export default function App() {
  const [gps, setGps] = useState<GpsState>({
    lat: null,
    lon: null,
    accuracy: null,
    error: null,
  });

  const [rows, setRows] = useState<BodyRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() =>
  readStoredSelectedTarget()
);

const [aimMode, setAimMode] = useState<AimMode>(() =>
  readStoredAimMode()
);

  const [orientation, setOrientation] = useState<OrientationState>({
    enabled: false,
    rawHeading: null,
    smoothHeading: null,
    beta: null,
    gamma: null,
    deviceAltitude: null,
    error: null,
  });

  const [offsetDeg, setOffsetDeg] = useState<number>(() => {
    const saved = localStorage.getItem(OFFSET_KEY);
    const parsed = saved === null ? 0 : Number(saved);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(
    null
  );

  const headingSamplesRef = useRef<number[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const selectedTarget = useMemo(() => {
    return (
      rows.find((row) => row.id === selectedId) ??
      rows.find((row) => row.id === "Luna") ??
      null
    );
  }, [rows, selectedId]);

  const isSolarTarget = selectedTarget?.id === "Sole";
  const isGuidanceDisabled =
    selectedTarget === null || isSolarTarget || !selectedTarget.guideAllowed;

  const observationPlan = useMemo(() => {
    if (gps.lat === null || gps.lon === null) return [];
    return buildObservationPlan(gps.lat, gps.lon, rows);
  }, [gps.lat, gps.lon, rows]);

  const currentSelectedPlan = useMemo(() => {
    return observationPlan.find((item) => item.id === selectedId) ?? null;
  }, [observationPlan, selectedId]);

  const guidanceDisabledReason = useMemo(() => {
    if (!selectedTarget) return "Nessun target disponibile.";

    if (isSolarTarget) {
      return "Il Sole è in Solar Safe Mode: guida, AR e TARGET LOCK sono disattivati.";
    }

    if (!selectedTarget.visible) {
      return `${selectedTarget.label} è sotto l’orizzonte.`;
    }

    if (!selectedTarget.guideAllowed) {
      return selectedTarget.observationReason;
    }

    return null;
  }, [selectedTarget, isSolarTarget]);

  const correctedHeading = useMemo(() => {
    if (orientation.smoothHeading === null) return null;
    return normalize360(orientation.smoothHeading + offsetDeg);
  }, [orientation.smoothHeading, offsetDeg]);

  const skyFinderDeltaAz = useMemo(() => {
    if (!selectedTarget || correctedHeading === null) return null;
    return normalize180(selectedTarget.azimuth - correctedHeading);
  }, [selectedTarget, correctedHeading]);

  const skyFinderMessage = useMemo(() => {
    return skyFinderTurnText(selectedTarget, correctedHeading);
  }, [selectedTarget, correctedHeading]);

  const fieldMessage = useMemo(() => {
    return fieldTurnShort(selectedTarget, correctedHeading);
  }, [selectedTarget, correctedHeading]);

  const deltaAz = useMemo(() => {
    if (isGuidanceDisabled) return null;
    if (!selectedTarget || correctedHeading === null) return null;
    return normalize180(selectedTarget.azimuth - correctedHeading);
  }, [selectedTarget, correctedHeading, isGuidanceDisabled]);

  const deltaAlt = useMemo(() => {
    if (isGuidanceDisabled) return null;
    if (!selectedTarget || orientation.deviceAltitude === null) return null;
    return selectedTarget.altitude - orientation.deviceAltitude;
  }, [selectedTarget, orientation.deviceAltitude, isGuidanceDisabled]);

  const telescopeAzLock =
    aimMode === "telescope" &&
    !isGuidanceDisabled &&
    deltaAz !== null &&
    Math.abs(deltaAz) <= 1.5;

  const telescopeAltLock =
    aimMode === "telescope" &&
    !isGuidanceDisabled &&
    deltaAlt !== null &&
    Math.abs(deltaAlt) <= 2.0;

  const telescopeTargetLock = telescopeAzLock && telescopeAltLock;

  const canCalibrateOnSelectedTarget =
    selectedTarget !== null &&
    !isSolarTarget &&
    selectedTarget.calibrationAllowed &&
    orientation.smoothHeading !== null &&
    aimMode === "telescope";

  const calibrationButtonLabel =
    aimMode !== "telescope"
      ? "Calibrazione solo in Telescopio"
      : selectedTarget?.id === "Sole"
        ? "Sole non calibrabile direttamente"
        : selectedTarget && !selectedTarget.calibrationAllowed
          ? `${selectedTarget.label} non calibrabile ora`
          : selectedTarget
            ? `Calibra su ${selectedTarget.label}`
            : "Calibra target";

  const arMarker = useMemo(() => {
    if (isGuidanceDisabled) return null;
    if (aimMode !== "camera") return null;
    if (deltaAz === null || deltaAlt === null) return null;

    const horizontalFovDeg = 60;
    const verticalFovDeg = 45;

    const rawX = 50 + (deltaAz / (horizontalFovDeg / 2)) * 50;
    const rawY = 50 - (deltaAlt / (verticalFovDeg / 2)) * 50;

    const inside = rawX >= 0 && rawX <= 100 && rawY >= 0 && rawY <= 100;

    return {
      x: clamp(rawX, 6, 94),
      y: clamp(rawY, 6, 94),
      inside,
    };
  }, [deltaAz, deltaAlt, isGuidanceDisabled, aimMode]);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;

    setIsStandalone(standalone);
  }, []);
useEffect(() => {
  try {
    localStorage.setItem(AIM_MODE_KEY, aimMode);
  } catch {
    // Ignora errori localStorage.
  }
}, [aimMode]);

useEffect(() => {
  try {
    localStorage.setItem(SELECTED_TARGET_KEY, selectedId);
  } catch {
    // Ignora errori localStorage.
  }
}, [selectedId]);

useEffect(() => {
  if (rows.length === 0) return;

  const targetExists = rows.some((row) => row.id === selectedId);

  if (!targetExists) {
    setSelectedId("Luna");
  }
}, [rows, selectedId]);
  useEffect(() => {
    if (!navigator.geolocation) {
      setGps((prev) => ({
        ...prev,
        error: "GPS non disponibile su questo browser.",
      }));
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
        });
      },
      (err) => {
        setGps((prev) => ({
          ...prev,
          error: `GPS: ${err.message}`,
        }));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (gps.lat === null || gps.lon === null) return;

    const calculate = () => {
      const now = new Date();
      const observer = new Observer(gps.lat!, gps.lon!, 0);

      const rawRows = SKY_BODIES.map(({ body, label }) => {
        const eq = Equator(body, now, observer, true, true);
        const hor = Horizon(now, observer, eq.ra, eq.dec, "normal");

        return {
          id: label,
          label,
          azimuth: hor.azimuth,
          altitude: hor.altitude,
          visible: hor.altitude > 0,
        };
      });

      const sunAltitude =
        rawRows.find((row) => row.id === "Sole")?.altitude ?? 90;

      const nextRows: BodyRow[] = rawRows.map((row) => ({
        ...row,
        ...analyzeObservability(row.label, row.altitude, sunAltitude),
      }));

      setRows(nextRows);
    };

    calculate();
    const interval = window.setInterval(calculate, 5000);

    return () => window.clearInterval(interval);
  }, [gps.lat, gps.lon]);

  useEffect(() => {
    if (aimMode === "camera" && !isGuidanceDisabled) return;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }, [isGuidanceDisabled, aimMode]);

  useEffect(() => {
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function enableCompass() {
    setOrientation((prev) => ({ ...prev, error: null }));

    if (!("DeviceOrientationEvent" in window)) {
      setOrientation((prev) => ({
        ...prev,
        enabled: false,
        error: "Orientamento dispositivo non disponibile su questo browser.",
      }));
      return;
    }

    const DeviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    try {
      if (typeof DeviceOrientation.requestPermission === "function") {
        const permission = await DeviceOrientation.requestPermission();

        if (permission !== "granted") {
          setOrientation((prev) => ({
            ...prev,
            enabled: false,
            error: "Permesso orientamento negato.",
          }));
          return;
        }
      }

      window.addEventListener("deviceorientation", handleOrientation, true);

      setOrientation((prev) => ({
        ...prev,
        enabled: true,
        error: null,
      }));
    } catch (error) {
      setOrientation((prev) => ({
        ...prev,
        enabled: false,
        error:
          error instanceof Error
            ? error.message
            : "Errore attivazione bussola.",
      }));
    }
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const compassEvent = event as DeviceOrientationEvent & {
      webkitCompassHeading?: number;
    };

    let rawHeading: number | null = null;

    if (
      typeof compassEvent.webkitCompassHeading === "number" &&
      Number.isFinite(compassEvent.webkitCompassHeading)
    ) {
      rawHeading = normalize360(compassEvent.webkitCompassHeading);
    } else if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
      rawHeading = normalize360(360 - event.alpha);
    }

    const beta =
      typeof event.beta === "number" && Number.isFinite(event.beta)
        ? event.beta
        : null;

    const gamma =
      typeof event.gamma === "number" && Number.isFinite(event.gamma)
        ? event.gamma
        : null;

    const deviceAltitude = estimateDeviceAltitude(beta);

    if (rawHeading !== null) {
      headingSamplesRef.current = [
        ...headingSamplesRef.current,
        rawHeading,
      ].slice(-10);
    }

    const smoothHeading = circularMeanDeg(headingSamplesRef.current);

    setOrientation((prev) => ({
      ...prev,
      rawHeading,
      smoothHeading,
      beta,
      gamma,
      deviceAltitude,
      error: null,
    }));
  }

  function calibrateOnSelectedTarget() {
    setCalibrationMessage(null);

    if (aimMode !== "telescope") {
      setCalibrationMessage(
        "La calibrazione affidabile usa la modalità Telescopio Push-To: punta con il lato corto superiore dell’iPhone verso il target."
      );
      return;
    }

    if (!selectedTarget) {
      setCalibrationMessage("Nessun target selezionato.");
      return;
    }

    if (isSolarTarget) {
      setCalibrationMessage(
        "Per sicurezza il Sole non è calibrabile direttamente. Usa Luna, Giove, Venere o un altro corpo visibile."
      );
      return;
    }

    if (!selectedTarget.calibrationAllowed) {
      setCalibrationMessage(selectedTarget.observationReason);
      return;
    }

    if (orientation.smoothHeading === null) {
      setCalibrationMessage("Attiva prima la bussola.");
      return;
    }

    const nextOffset = normalize180(
      selectedTarget.azimuth - orientation.smoothHeading
    );

    setOffsetDeg(nextOffset);
    localStorage.setItem(OFFSET_KEY, String(nextOffset));

    setCalibrationMessage(
      `Calibrazione salvata su ${selectedTarget.label}: offset ${nextOffset.toFixed(
        1
      )}°. ${POINTER_AXIS}`
    );
  }

  function resetCalibration() {
    setOffsetDeg(0);
    localStorage.removeItem(OFFSET_KEY);
    setCalibrationMessage("Calibrazione azzerata.");
  }

  async function startCamera() {
    setCameraError(null);

    if (aimMode !== "camera") {
      setCameraError("Passa alla modalità Camera AR Preview.");
      return;
    }

    if (isGuidanceDisabled) {
      setCameraError(
        guidanceDisabledReason ??
          "Camera disattivata: target non osservabile ora."
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera non disponibile. Serve HTTPS o localhost.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraActive(true);

      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 0);
    } catch (error) {
      if (isStandalone) {
        setCameraError(
          "Su iPhone in modalità App la camera può essere limitata. Apri Astro Pons in Safari per preview camera completa."
        );
      } else {
        setCameraError(
          error instanceof Error ? error.message : "Permesso camera negato."
        );
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }

  function statusStyle(kind: StatusKind): CSSProperties {
    if (kind === "good") return styles.statusGood;
    if (kind === "medium") return styles.statusMedium;
    if (kind === "solar") return styles.statusSolar;
    return styles.statusBad;
  }

  function aimModeTitle(mode: AimMode): string {
    if (mode === "telescope") return "Telescopio Push-To";
    if (mode === "skyfinder") return "Sky Finder";
    if (mode === "field") return "Field Mode";
    return "Camera AR Preview";
  }

  function aimModeDescription(mode: AimMode): string {
    if (mode === "telescope") {
      return "Allinea il lato corto superiore dell’iPhone parallelamente all’asse del tubo del telescopio. Muovi il telescopio finché appare TARGET LOCK.";
    }

    if (mode === "skyfinder") {
      return "Per occhio nudo: la freccia blu indica dove punta il lato corto superiore dell’iPhone. Ruota il corpo/telefono finché la freccia si avvicina al target.";
    }

    if (mode === "field") {
      return "Schermata da campo: pochi dati, grandi, leggibili al buio. Target, direzione, altezza, freccia e finestra utile.";
    }

    return "Camera solo preview. Il puntamento affidabile resta sul lato corto superiore dell’iPhone: la camera non è ancora un asse ottico calibrato.";
  }

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <h1 style={styles.title}>Moon Compass</h1>
        <p style={styles.subtitle}>V6.4.2 — Safe Area + Field Warning Priority</p>
      </section>

      <section style={styles.statusCard}>
        <strong>
          Lat {gps.lat?.toFixed(4) ?? "—"} / Lon {gps.lon?.toFixed(4) ?? "—"}
        </strong>
        <span>
          {" | "}
          GPS {gps.accuracy !== null ? `±${gps.accuracy.toFixed(0)}m` : "—"}
          {" | "}
          Heading {formatDeg(orientation.smoothHeading)}
        </span>
        {gps.error && <p style={styles.error}>{gps.error}</p>}
      </section>
{aimMode === "field" && (
  <FieldModePanel
    target={selectedTarget}
    plan={currentSelectedPlan}
    heading={correctedHeading}
    fieldMessage={fieldMessage}
    disabledReason={guidanceDisabledReason}
    isSolarTarget={isSolarTarget}
    onEnableCompass={enableCompass}
  />
)}
      {aimMode !== "field" && (
        <section style={styles.axisCard}>
          <div style={styles.axisTitle}>Regola fisica dello strumento</div>
          <div style={styles.axisText}>{POINTER_AXIS}</div>
        </section>
      )}

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Modo puntamento</h2>

        <div style={styles.modeGrid}>
          <button
            style={{
              ...styles.modeButton,
              ...(aimMode === "telescope" ? styles.modeButtonActive : {}),
            }}
            onClick={() => setAimMode("telescope")}
          >
            Telescopio
          </button>

          <button
            style={{
              ...styles.modeButton,
              ...(aimMode === "skyfinder" ? styles.modeButtonActive : {}),
            }}
            onClick={() => setAimMode("skyfinder")}
          >
            Sky Finder
          </button>

          <button
            style={{
              ...styles.modeButton,
              ...(aimMode === "field" ? styles.modeButtonActive : {}),
            }}
            onClick={() => setAimMode("field")}
          >
            Field Mode
          </button>

          <button
            style={{
              ...styles.modeButton,
              ...(aimMode === "camera" ? styles.modeButtonActive : {}),
            }}
            onClick={() => setAimMode("camera")}
          >
            Camera AR
          </button>
        </div>

        {aimMode !== "field" && (
          <div style={styles.modeInfoBox}>
            <div style={styles.modeInfoTitle}>{aimModeTitle(aimMode)}</div>
            <div style={styles.modeInfoText}>{aimModeDescription(aimMode)}</div>
          </div>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Bussola + Calibrazione</h2>

        {aimMode !== "field" && (
          <div style={styles.calibrationHint}>
            Calibra tenendo il <strong>lato corto superiore dell’iPhone</strong>{" "}
            puntato verso il target reale.
          </div>
        )}

        {aimMode === "field" ? (
          <div style={styles.fieldCompassRow}>
            <button style={styles.primaryButton} onClick={enableCompass}>
              Attiva bussola
            </button>
            <button style={styles.secondaryButton} onClick={resetCalibration}>
              Reset
            </button>
          </div>
        ) : (
          <>
            <div style={styles.grid2}>
              <Info label="Heading raw" value={formatDeg(orientation.rawHeading)} />
              <Info
                label="Heading smooth"
                value={formatDeg(orientation.smoothHeading)}
              />
              <Info label="Offset calibrazione" value={formatDeg(offsetDeg)} />
              <Info label="Heading corretto" value={formatDeg(correctedHeading)} />
              <Info
                label="Pitch stimato"
                value={formatDeg(orientation.deviceAltitude)}
              />
              <Info
                label="Beta/Gamma"
                value={`${formatDeg(orientation.beta)} / ${formatDeg(
                  orientation.gamma
                )}`}
              />
            </div>

            <div style={styles.buttonRow}>
              <button style={styles.primaryButton} onClick={enableCompass}>
                Attiva bussola
              </button>

              <button
                style={{
                  ...styles.yellowButton,
                  ...(!canCalibrateOnSelectedTarget ? styles.disabledButton : {}),
                }}
                onClick={calibrateOnSelectedTarget}
                disabled={!canCalibrateOnSelectedTarget}
              >
                {calibrationButtonLabel}
              </button>

              <button style={styles.secondaryButton} onClick={resetCalibration}>
                Reset calibrazione
              </button>
            </div>
          </>
        )}

        {orientation.error && <p style={styles.error}>{orientation.error}</p>}

        {selectedTarget && isGuidanceDisabled && aimMode !== "field" && (
          <div style={isSolarTarget ? styles.sunWarning : styles.noticeBox}>
            {guidanceDisabledReason}
          </div>
        )}

        {calibrationMessage && aimMode !== "field" && (
          <div style={styles.noticeBox}>{calibrationMessage}</div>
        )}
      </section>

      {aimMode === "field" ? null : aimMode === "skyfinder" ? (
    
        <section style={styles.skyFinderCard}>
          <h2 style={styles.sectionTitle}>Sky Finder Radar</h2>

          <div style={styles.skyTargetName}>
            Target: <strong>{selectedTarget?.label ?? "—"}</strong>
          </div>

          <SkyRadar target={selectedTarget} heading={correctedHeading} />

          <div style={styles.skyGrid}>
            <div style={styles.skyMetric}>
              <span>Direzione</span>
              <strong>{azimuthToCompass(selectedTarget?.azimuth ?? null)}</strong>
            </div>

            <div style={styles.skyMetric}>
              <span>Azimut</span>
              <strong>{formatDeg(selectedTarget?.azimuth ?? null)}</strong>
            </div>

            <div style={styles.skyMetric}>
              <span>Altezza</span>
              <strong>{formatDeg(selectedTarget?.altitude ?? null)}</strong>
            </div>

            <div style={styles.skyMetric}>
              <span>Fascia cielo</span>
              <strong>{altitudeBand(selectedTarget?.altitude ?? null)}</strong>
            </div>

            <div style={styles.skyMetric}>
              <span>Bussola corretta</span>
              <strong>{formatDeg(correctedHeading)}</strong>
            </div>

            <div style={styles.skyMetric}>
              <span>Scarto direzione</span>
              <strong>{formatDeg(skyFinderDeltaAz)}</strong>
            </div>
          </div>

          <div style={styles.skyAdvice}>
            <div style={styles.skyAdviceMain}>{skyFinderMessage}</div>

            {selectedTarget?.observableNow ? (
              <div>
                Guarda verso{" "}
                <strong>{azimuthToCompass(selectedTarget.azimuth)}</strong>, a
                quota <strong>{altitudeBand(selectedTarget.altitude)}</strong>.
              </div>
            ) : currentSelectedPlan?.firstUsefulTime ? (
              <div>
                Prima finestra utile:{" "}
                <strong>{currentSelectedPlan.firstUsefulTime}</strong>. Momento
                migliore: <strong>{currentSelectedPlan.bestTime ?? "—"}</strong>.
              </div>
            ) : (
              <div>
                Nessuna finestra utile nelle prossime {FORECAST_HOURS} ore.
              </div>
            )}
          </div>

          {isSolarTarget && (
            <div style={styles.sunWarning}>
              Il Sole resta solo dato astronomico. Non guardare né puntare
              strumenti ottici verso il Sole senza filtro certificato.
            </div>
          )}
        </section>
      ) : aimMode === "camera" && !isGuidanceDisabled ? (
        <section style={styles.cameraSafeCard}>
          <h2 style={styles.sectionTitle}>Camera AR Preview</h2>

          <div style={styles.targetName}>
            Target: <strong>{selectedTarget?.label ?? "—"}</strong>
          </div>

          <div style={styles.noticeBox}>
            Camera solo preview. Il puntamento affidabile resta sul{" "}
            <strong>lato corto superiore dell’iPhone</strong>. La camera non è
            ancora asse ottico calibrato.
          </div>

          <div style={styles.cameraSafeGrid}>
            <div style={styles.cameraSafeMetric}>
              <span>Azimut target</span>
              <strong>{formatDeg(selectedTarget?.azimuth ?? null)}</strong>
            </div>

            <div style={styles.cameraSafeMetric}>
              <span>Altezza target</span>
              <strong>{formatDeg(selectedTarget?.altitude ?? null)}</strong>
            </div>

            <div style={styles.cameraSafeMetric}>
              <span>Delta Az indicativo</span>
              <strong>{formatDeg(deltaAz)}</strong>
            </div>

            <div style={styles.cameraSafeMetric}>
              <span>Delta Alt indicativo</span>
              <strong>{formatDeg(deltaAlt)}</strong>
            </div>
          </div>

          <div style={styles.cameraSafeWarning}>
            Per puntamento affidabile usa <strong>Telescopio Push-To</strong>.
            Allinea sempre il lato corto superiore dell’iPhone all’asse desiderato.
          </div>
        </section>
      ) : isGuidanceDisabled ? (
        <section
          style={isSolarTarget ? styles.solarSafeCard : styles.disabledGuideCard}
        >
          <h2 style={styles.sectionTitle}>
            {isSolarTarget ? "Solar Safe Mode" : "Guida disattivata"}
          </h2>

          <div
            style={isSolarTarget ? styles.solarTitle : styles.disabledGuideTitle}
          >
            {selectedTarget?.label ?? "Target"} selezionato
          </div>

          <p style={styles.solarText}>{guidanceDisabledReason}</p>

          <div style={styles.solarGrid}>
            <div style={styles.solarMetric}>
              <span>Azimut</span>
              <strong>{formatDeg(selectedTarget?.azimuth ?? null)}</strong>
            </div>
            <div style={styles.solarMetric}>
              <span>Altezza</span>
              <strong>{formatDeg(selectedTarget?.altitude ?? null)}</strong>
            </div>
            <div style={styles.solarMetric}>
              <span>Stato geometrico</span>
              <strong>
                {selectedTarget?.visible ? "Sopra orizzonte" : "Sotto"}
              </strong>
            </div>
            <div style={styles.solarMetric}>
              <span>Osservabilità</span>
              <strong>{selectedTarget?.observationLabel ?? "—"}</strong>
            </div>
          </div>

          {isSolarTarget && (
            <div style={styles.sunWarning}>
              Per osservazione solare usa solo filtro solare certificato davanti
              all’ottica oppure tecniche indirette come proiezione/ombra.
            </div>
          )}
        </section>
      ) : (
        <section style={telescopeTargetLock ? styles.lockCard : styles.card}>
          <h2 style={styles.sectionTitle}>Precision Telescope</h2>

          <div style={styles.targetName}>
            Target: <strong>{selectedTarget?.label ?? "—"}</strong>
          </div>

          <div style={styles.noticeBox}>
            Allinea il <strong>lato corto superiore dell’iPhone</strong>{" "}
            parallelamente all’asse del tubo del telescopio. Muovi il telescopio
            finché appare <strong>TARGET LOCK</strong>.
          </div>

          {telescopeTargetLock ? (
            <div style={styles.lockText}>✓ TARGET LOCK</div>
          ) : (
            <div style={styles.precisionGrid}>
              <div style={styles.directionBox}>
                <div style={telescopeAzLock ? styles.okText : styles.bigYellow}>
                  {directionText(deltaAz)}
                </div>
                <div style={styles.metric}>Delta Az: {formatDeg(deltaAz)}</div>
              </div>

              <div style={styles.directionBox}>
                <div style={telescopeAltLock ? styles.okText : styles.bigYellow}>
                  {altitudeText(deltaAlt)}
                </div>
                <div style={styles.metric}>Delta Alt: {formatDeg(deltaAlt)}</div>
              </div>
            </div>
          )}

          <div style={styles.lockGrid}>
            <span style={telescopeAzLock ? styles.greenBadge : styles.redBadge}>
              Azimut {telescopeAzLock ? "OK" : "NO"}
            </span>
            <span style={telescopeAltLock ? styles.greenBadge : styles.redBadge}>
              Altezza {telescopeAltLock ? "OK" : "NO"}
            </span>
          </div>
        </section>
      )}

      <section style={styles.card}>
        <label style={styles.label}>Seleziona target</label>
        <select
          style={styles.select}
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </section>

      {aimMode !== "field" && (
        <>
          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>Osservazione Pro</h2>

            <p style={styles.smallText}>
              Migliori target nelle prossime {FORECAST_HOURS} ore. L’app indica
              prima finestra utile, momento migliore e osservabilità reale.
            </p>

            {observationPlan.length === 0 ? (
              <p style={styles.smallText}>Attendo GPS e dati astronomici...</p>
            ) : (
              <div style={styles.planList}>
                {observationPlan.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    style={{
                      ...styles.planItem,
                      ...(item.id === selectedId ? styles.selectedPlanItem : {}),
                    }}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div style={styles.planTop}>
                      <strong>{item.label}</strong>
                      <span style={statusStyle(item.statusKind)}>
                        {item.rating}
                      </span>
                    </div>

                    <div style={styles.planGrid}>
                      <span>Ora: {item.currentLabel}</span>
                      <span>Alt ora: {formatDeg(item.currentAltitude)}</span>
                      <span>Prima utile: {item.firstUsefulTime ?? "—"}</span>
                      <span>Migliore: {item.bestTime ?? "—"}</span>
                      <span>Alt max: {item.bestAltitude.toFixed(1)}°</span>
                      <span>Score: {item.score}/100</span>
                    </div>

                    <div style={styles.planAdvice}>{item.advice}</div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <span>Corpo</span>
              <span>Azimut</span>
              <span>Altezza</span>
              <span>Osservabilità</span>
            </div>

            {rows.map((row) => (
              <button
                key={row.id}
                style={{
                  ...styles.tableRow,
                  ...(row.id === selectedId ? styles.selectedRow : {}),
                }}
                onClick={() => setSelectedId(row.id)}
              >
                <span>{row.label}</span>
                <span>{row.azimuth.toFixed(1)}°</span>
                <span>{row.altitude.toFixed(1)}°</span>
                <span style={statusStyle(row.statusKind)}>
                  {row.observationLabel}
                </span>
              </button>
            ))}
          </section>

          <section
            style={
              aimMode === "camera" && !isGuidanceDisabled
                ? styles.arCard
                : styles.disabledArCard
            }
          >
            <h2 style={styles.sectionTitle}>Camera AR Preview</h2>

            {aimMode !== "camera" ? (
              <>
                <p style={styles.solarText}>
                  Camera disattivata perché il modo attivo è{" "}
                  <strong>{aimModeTitle(aimMode)}</strong>.
                </p>
                <div style={styles.noticeBox}>
                  Passa a <strong>Camera AR</strong> per usare la preview video.
                </div>
              </>
            ) : isGuidanceDisabled ? (
              <>
                <p style={styles.solarText}>
                  Camera AR disattivata per questo target.
                </p>
                <div style={isSolarTarget ? styles.sunWarning : styles.noticeBox}>
                  {guidanceDisabledReason}
                </div>
              </>
            ) : (
              <>
                <p style={styles.smallText}>
                  Camera posteriore + overlay indicativo. Nessun TARGET LOCK viene
                  dichiarato in questa modalità.
                </p>

                <div style={styles.noticeBox}>
                  Puntamento sempre riferito al{" "}
                  <strong>lato corto superiore dell’iPhone</strong>. La camera è
                  solo una preview.
                </div>

                {isStandalone && (
                  <div style={styles.noticeBox}>
                    Modalità App iPhone rilevata. Se la camera non parte, apri
                    Astro Pons in Safari per preview camera completa.
                  </div>
                )}

                <div style={styles.buttonRow}>
                  <button style={styles.primaryButton} onClick={startCamera}>
                    Avvia AR Camera
                  </button>
                  <button style={styles.secondaryButton} onClick={stopCamera}>
                    Stop Camera
                  </button>
                </div>

                {cameraError && <p style={styles.error}>{cameraError}</p>}

                <div style={styles.arFrame}>
                  {cameraActive ? (
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      style={styles.arVideo}
                    />
                  ) : (
                    <div style={styles.cameraPlaceholder}>Camera non attiva</div>
                  )}

                  <div style={styles.arOverlay}>
                    <div style={styles.reticle}>
                      <div style={styles.reticleH} />
                      <div style={styles.reticleV} />
                    </div>

                    {arMarker && (
                      <div
                        style={{
                          ...styles.marker,
                          ...(arMarker.inside ? {} : styles.markerOffscreen),
                          left: `${arMarker.x}%`,
                          top: `${arMarker.y}%`,
                        }}
                      >
                        <div style={styles.markerDot} />
                        <div style={styles.markerLabel}>
                          {selectedTarget?.label ?? "Target"}
                        </div>
                      </div>
                    )}

                    <div style={styles.arInstruction}>
                      <span style={styles.arPreviewText}>Preview indicativa</span>
                      <span>Asse camera non calibrato</span>
                      <span>Punta reale: lato superiore iPhone</span>
                    </div>
                  </div>
                </div>

                <div style={styles.arInfoGrid}>
                  <div style={styles.arMiniMetric}>
                    Delta Az indicativo {formatDeg(deltaAz)}
                  </div>
                  <div style={styles.arMiniMetric}>
                    Delta Alt indicativo {formatDeg(deltaAlt)}
                  </div>
                  <div style={styles.arMiniMetric}>
                    Marker {arMarker?.inside ? "nel frame" : "fuori frame"}
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function FieldModePanel({
  target,
  plan,
  heading,
  fieldMessage,
  disabledReason,
  isSolarTarget,
  onEnableCompass,
}: {
  target: BodyRow | null;
  plan: ObservationItem | null;
  heading: number | null;
  fieldMessage: string;
  disabledReason: string | null;
  isSolarTarget: boolean;
  onEnableCompass: () => void;
}) {
  const color = statusColorValue(target?.statusKind);
  const observable = target?.observableNow ?? false;

  const fieldStatusText = isSolarTarget
    ? "SOLAR SAFE"
    : observable
      ? "OSSERVABILE"
      : target?.observationLabel?.toUpperCase() ?? "—";
  const fieldPriorityText = isSolarTarget
      ? "NON PUNTARE IL SOLE"
      : fieldMessage;
  return (
    <section style={styles.fieldCard}>
      <div style={styles.fieldHeader}>FIELD MODE</div>

      <div style={styles.fieldTarget}>{target?.label?.toUpperCase() ?? "—"}</div>

      <div style={{ ...styles.fieldStatus, color }}>
  {fieldStatusText}
</div>

<button style={styles.fieldQuickCompassButton} onClick={onEnableCompass}>
  ATTIVA BUSSOLA
</button>

{!observable && (
  <div style={isSolarTarget ? styles.fieldSolarPriority : styles.fieldPriorityWarning}>
    {fieldPriorityText}
  </div>
)}

<FieldRadar target={target} heading={heading} />
      <div style={styles.fieldMainGrid}>
  <div style={observable ? styles.fieldBigBox : styles.fieldBigBoxSecondary}>
    <span>{observable ? "GUARDA" : "DIREZIONE GEOMETRICA"}</span>
    <strong>{azimuthToCompass(target?.azimuth ?? null).toUpperCase()}</strong>
  </div>

  <div style={observable ? styles.fieldBigBox : styles.fieldBigBoxSecondary}>
    <span>ALTEZZA</span>
    <strong>{fieldAltitudeBand(target?.altitude ?? null)}</strong>
  </div>
</div>

{observable && (
  <div style={styles.fieldInstructionGood}>
    {fieldMessage}
  </div>
)}

      <div style={observable ? styles.fieldInstructionGood : styles.fieldInstructionBad}>
        {fieldMessage}
      </div>

      <div style={styles.fieldTimeGrid}>
        <div style={styles.fieldTimeBox}>
          <span style={styles.fieldTimeLabel}>ORA</span>
          <strong style={styles.fieldTimeValue}>
            {target?.observableNow ? "SÌ" : "NO"}
          </strong>
        </div>

        <div style={styles.fieldTimeBox}>
          <span style={styles.fieldTimeLabel}>PRIMA UTILE</span>
          <strong style={styles.fieldTimeValue}>
            {plan?.firstUsefulTime ?? "—"}
          </strong>
        </div>

        <div style={styles.fieldTimeBox}>
          <span style={styles.fieldTimeLabel}>MIGLIORE</span>
          <strong style={styles.fieldTimeValue}>
            {plan?.bestTime ?? "—"}
          </strong>
        </div>
      </div>

      {disabledReason && (
        <div style={isSolarTarget ? styles.sunWarning : styles.noticeBox}>
          {disabledReason}
        </div>
      )}

      <button style={styles.fieldCompassButton} onClick={onEnableCompass}>
        ATTIVA / RIATTIVA BUSSOLA
      </button>

      <div style={styles.fieldAxis}>
        Freccia blu = lato corto superiore dell’iPhone
      </div>
    </section>
  );
}

function SkyRadar({
  target,
  heading,
}: {
  target: BodyRow | null;
  heading: number | null;
}) {
  const point = radarPointFromAzAlt(
    target?.azimuth ?? null,
    target?.altitude ?? null
  );

  const color = statusColorValue(target?.statusKind);

  return (
    <div style={styles.radarWrap}>
      <div style={styles.radar}>
        <div style={styles.radarRingOuter} />
        <div style={styles.radarRingMid} />
        <div style={styles.radarRingInner} />

        <div style={styles.radarAxisVertical} />
        <div style={styles.radarAxisHorizontal} />

        <div style={styles.radarLabelN}>N</div>
        <div style={styles.radarLabelE}>E</div>
        <div style={styles.radarLabelS}>S</div>
        <div style={styles.radarLabelW}>O</div>

        <div style={styles.radarZenith}>Zenit</div>
        <div style={styles.radarHorizon}>orizzonte</div>

        {heading !== null && (
          <div
            style={{
              ...styles.radarHeadingLine,
              transform: `translate(-50%, -100%) rotate(${heading}deg)`,
            }}
          />
        )}

        {point && target && (
          <>
            <div
              style={{
                ...styles.radarTargetDot,
                left: `${point.x}%`,
                top: `${point.y}%`,
                background: color,
                boxShadow: `0 0 22px ${color}`,
              }}
            />
            <div
              style={{
                ...styles.radarTargetLabel,
                left: `${point.x}%`,
                top: `${point.y}%`,
                color,
              }}
            >
              {target.label}
            </div>
          </>
        )}
      </div>

      <div style={styles.radarPointerLegend}>
        Freccia blu = lato corto superiore dell’iPhone.
      </div>

      <div style={styles.radarLegend}>
        <span>
          <strong>Centro</strong> = alto
        </span>
        <span>
          <strong>Bordo</strong> = basso/orizzonte
        </span>
      </div>
    </div>
  );
}

function FieldRadar({
  target,
  heading,
}: {
  target: BodyRow | null;
  heading: number | null;
}) {
  const point = radarPointFromAzAlt(
    target?.azimuth ?? null,
    target?.altitude ?? null
  );

  const color = statusColorValue(target?.statusKind);

  return (
    <div style={styles.fieldRadar}>
      <div style={styles.fieldRadarRingOuter} />
      <div style={styles.fieldRadarRingMid} />
      <div style={styles.fieldRadarRingInner} />

      <div style={styles.fieldRadarAxisVertical} />
      <div style={styles.fieldRadarAxisHorizontal} />

      <div style={styles.fieldRadarN}>N</div>
      <div style={styles.fieldRadarE}>E</div>
      <div style={styles.fieldRadarS}>S</div>
      <div style={styles.fieldRadarW}>O</div>

      {heading !== null && (
        <div
          style={{
            ...styles.fieldRadarHeading,
            transform: `translate(-50%, -100%) rotate(${heading}deg)`,
          }}
        />
      )}

      {point && target && (
        <>
          <div
            style={{
              ...styles.fieldRadarDot,
              left: `${point.x}%`,
              top: `${point.y}%`,
              background: color,
              boxShadow: `0 0 30px ${color}`,
            }}
          />
          <div
            style={{
              ...styles.fieldRadarLabel,
              left: `${point.x}%`,
              top: `${point.y}%`,
              color,
            }}
          >
            {target.label}
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.infoBox}>
      <div style={styles.infoLabel}>{label}</div>
      <div style={styles.infoValue}>{value}</div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
  minHeight: "100vh",
  background: "#05081f",
  color: "#f3f5ff",
  padding: "calc(56px + env(safe-area-inset-top)) 16px calc(48px + env(safe-area-inset-bottom))",
  scrollPaddingTop: "calc(72px + env(safe-area-inset-top))",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  header: {
    textAlign: "center",
    marginBottom: 24,
  },
  title: {
    color: "#ffd400",
    fontSize: 42,
    lineHeight: 1,
    margin: "0 0 10px",
    fontWeight: 900,
  },
  subtitle: {
    color: "#a9adbd",
    fontSize: 18,
    margin: 0,
    fontWeight: 700,
  },
  statusCard: {
    background: "#1b203a",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    textAlign: "center",
    color: "#e6e8f2",
    fontSize: 16,
  },
  axisCard: {
    background: "rgba(0,183,255,0.10)",
    border: "1px solid rgba(0,183,255,0.42)",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    textAlign: "center",
  },
  axisTitle: {
    color: "#00b7ff",
    fontSize: 17,
    fontWeight: 1000,
    marginBottom: 6,
  },
  axisText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: 900,
    lineHeight: 1.35,
  },
  card: {
    background: "#1b203a",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
  },
  lockCard: {
    background: "#102b21",
    border: "2px solid #15ff31",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 0 30px rgba(21,255,49,0.12)",
  },
  cameraSafeCard: {
    background: "#10202d",
    border: "2px solid rgba(0,183,255,0.55)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 0 28px rgba(0,183,255,0.1)",
  },
  cameraSafeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginTop: 14,
  },
  cameraSafeMetric: {
    background: "#11162c",
    borderRadius: 12,
    padding: 12,
    display: "grid",
    gap: 4,
    textAlign: "center",
  },
  cameraSafeWarning: {
    background: "rgba(255,212,0,0.12)",
    color: "#ffd400",
    border: "1px solid rgba(255,212,0,0.35)",
    borderRadius: 12,
    padding: 12,
    fontWeight: 900,
    marginTop: 14,
    lineHeight: 1.4,
    textAlign: "center",
  },
  modeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10,
  },
  modeButton: {
    background: "#11162c",
    color: "#ffffff",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: "14px 12px",
    fontSize: 17,
    fontWeight: 900,
  },
  modeButtonActive: {
    background: "#ffd400",
    color: "#090909",
    border: "1px solid rgba(255,212,0,0.8)",
  },
  modeInfoBox: {
    marginTop: 14,
    background: "#11162c",
    borderRadius: 14,
    padding: 14,
    border: "1px solid rgba(255,255,255,0.08)",
  },
  modeInfoTitle: {
    color: "#ffd400",
    fontSize: 20,
    fontWeight: 1000,
    marginBottom: 8,
    textAlign: "center",
  },
  modeInfoText: {
    color: "#d8dbea",
    fontSize: 15,
    lineHeight: 1.45,
    fontWeight: 800,
    textAlign: "center",
  },
  calibrationHint: {
    background: "rgba(255,212,0,0.10)",
    border: "1px solid rgba(255,212,0,0.28)",
    color: "#ffd400",
    borderRadius: 12,
    padding: 12,
    fontWeight: 900,
    textAlign: "center",
    lineHeight: 1.35,
    marginBottom: 14,
  },
  fieldCompassRow: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
  },
  fieldQuickCompassButton: {
  width: "100%",
  background: "#00b7ff",
  color: "#00111a",
  border: 0,
  borderRadius: 14,
  padding: "16px 14px",
  fontSize: 20,
  fontWeight: 1000,
  marginBottom: 16,
},
  skyFinderCard: {
    background: "#101d2d",
    border: "2px solid rgba(0,183,255,0.45)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
  },
  skyTargetName: {
    textAlign: "center",
    fontSize: 24,
    marginBottom: 14,
  },
  skyGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginBottom: 14,
  },
  skyMetric: {
    background: "#11162c",
    borderRadius: 12,
    padding: 12,
    display: "grid",
    gap: 4,
    textAlign: "center",
  },
  skyAdvice: {
    background: "rgba(255,212,0,0.12)",
    border: "1px solid rgba(255,212,0,0.35)",
    color: "#ffd400",
    borderRadius: 14,
    padding: 14,
    lineHeight: 1.45,
    fontWeight: 900,
    textAlign: "center",
  },
  skyAdviceMain: {
    fontSize: 18,
    marginBottom: 8,
  },
  radarWrap: {
    marginBottom: 16,
  },
  radar: {
    position: "relative",
    width: "min(100%, 340px)",
    aspectRatio: "1 / 1",
    margin: "0 auto 10px",
    borderRadius: "50%",
    background:
      "radial-gradient(circle at center, rgba(0,183,255,0.18), rgba(5,8,31,0.92) 62%, rgba(5,8,31,1))",
    border: "2px solid rgba(0,183,255,0.55)",
    overflow: "hidden",
    boxShadow: "0 0 28px rgba(0,183,255,0.18)",
  },
  radarRingOuter: {
    position: "absolute",
    inset: "8%",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.25)",
  },
  radarRingMid: {
    position: "absolute",
    inset: "26%",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.18)",
  },
  radarRingInner: {
    position: "absolute",
    inset: "42%",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.14)",
  },
  radarAxisVertical: {
    position: "absolute",
    left: "50%",
    top: "7%",
    bottom: "7%",
    width: 1,
    background: "rgba(255,255,255,0.18)",
  },
  radarAxisHorizontal: {
    position: "absolute",
    top: "50%",
    left: "7%",
    right: "7%",
    height: 1,
    background: "rgba(255,255,255,0.18)",
  },
  radarLabelN: {
    position: "absolute",
    top: 8,
    left: "50%",
    transform: "translateX(-50%)",
    color: "#ffffff",
    fontWeight: 1000,
  },
  radarLabelE: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#ffffff",
    fontWeight: 1000,
  },
  radarLabelS: {
    position: "absolute",
    bottom: 8,
    left: "50%",
    transform: "translateX(-50%)",
    color: "#ffffff",
    fontWeight: 1000,
  },
  radarLabelW: {
    position: "absolute",
    left: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#ffffff",
    fontWeight: 1000,
  },
  radarZenith: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: 900,
  },
  radarHorizon: {
    position: "absolute",
    left: "50%",
    bottom: 30,
    transform: "translateX(-50%)",
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: 900,
  },
  radarHeadingLine: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 4,
    height: "43%",
    transformOrigin: "50% 100%",
    background: "#00b7ff",
    borderRadius: 999,
    boxShadow: "0 0 18px rgba(0,183,255,0.8)",
  },
  radarTargetDot: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    border: "3px solid rgba(255,255,255,0.9)",
    zIndex: 4,
  },
  radarTargetLabel: {
    position: "absolute",
    transform: "translate(-50%, 14px)",
    fontSize: 14,
    fontWeight: 1000,
    textShadow: "0 2px 8px rgba(0,0,0,0.9)",
    zIndex: 4,
  },
  radarPointerLegend: {
    background: "rgba(0,183,255,0.12)",
    border: "1px solid rgba(0,183,255,0.35)",
    color: "#00b7ff",
    borderRadius: 12,
    padding: 10,
    fontSize: 14,
    fontWeight: 1000,
    textAlign: "center",
    marginBottom: 8,
  },
  radarLegend: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    color: "#a9adbd",
    fontSize: 13,
    textAlign: "center",
  },
  fieldCard: {
    background: "#050b18",
    border: "2px solid rgba(0,183,255,0.65)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 0 34px rgba(0,183,255,0.14)",
  },
  fieldHeader: {
    color: "#00b7ff",
    textAlign: "center",
    fontSize: 18,
    fontWeight: 1000,
    letterSpacing: 2,
    marginBottom: 8,
  },
  fieldTarget: {
    color: "#ffffff",
    textAlign: "center",
    fontSize: 50,
    lineHeight: 1,
    fontWeight: 1000,
    marginBottom: 8,
  },
  fieldStatus: {
    textAlign: "center",
    fontSize: 26,
    fontWeight: 1000,
    marginBottom: 14,
  },
  fieldRadar: {
    position: "relative",
    width: "min(100%, 360px)",
    aspectRatio: "1 / 1",
    margin: "0 auto 16px",
    borderRadius: "50%",
    background:
      "radial-gradient(circle at center, rgba(0,183,255,0.20), rgba(5,8,31,0.94) 63%, rgba(5,8,31,1))",
    border: "2px solid rgba(0,183,255,0.75)",
    overflow: "hidden",
    boxShadow: "0 0 30px rgba(0,183,255,0.20)",
  },
  fieldRadarRingOuter: {
    position: "absolute",
    inset: "7%",
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.25)",
  },
  fieldPriorityWarning: {
  background: "rgba(255,102,102,0.14)",
  color: "#ff6666",
  border: "1px solid rgba(255,102,102,0.45)",
  borderRadius: 16,
  padding: 16,
  fontSize: 30,
  fontWeight: 1000,
  textAlign: "center",
  marginBottom: 16,
},

fieldSolarPriority: {
  background: "rgba(255,90,90,0.18)",
  color: "#ff7777",
  border: "1px solid rgba(255,90,90,0.55)",
  borderRadius: 16,
  padding: 16,
  fontSize: 28,
  fontWeight: 1000,
  textAlign: "center",
  marginBottom: 16,
},

fieldBigBoxSecondary: {
  background: "rgba(17,22,44,0.72)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  textAlign: "center",
  display: "grid",
  gap: 6,
  opacity: 0.78,
},
  fieldRadarRingMid: {
    position: "absolute",
    inset: "28%",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.18)",
  },
  fieldRadarRingInner: {
    position: "absolute",
    inset: "44%",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.14)",
  },
  fieldRadarAxisVertical: {
    position: "absolute",
    left: "50%",
    top: "7%",
    bottom: "7%",
    width: 1,
    background: "rgba(255,255,255,0.2)",
  },
  fieldRadarAxisHorizontal: {
    position: "absolute",
    top: "50%",
    left: "7%",
    right: "7%",
    height: 1,
    background: "rgba(255,255,255,0.2)",
  },
  fieldRadarN: {
    position: "absolute",
    top: 8,
    left: "50%",
    transform: "translateX(-50%)",
    color: "#ffffff",
    fontSize: 20,
    fontWeight: 1000,
  },
  fieldRadarE: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#ffffff",
    fontSize: 20,
    fontWeight: 1000,
  },
  fieldRadarS: {
    position: "absolute",
    bottom: 8,
    left: "50%",
    transform: "translateX(-50%)",
    color: "#ffffff",
    fontSize: 20,
    fontWeight: 1000,
  },
  fieldRadarW: {
    position: "absolute",
    left: 10,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#ffffff",
    fontSize: 20,
    fontWeight: 1000,
  },
  fieldRadarHeading: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 6,
    height: "43%",
    transformOrigin: "50% 100%",
    background: "#00b7ff",
    borderRadius: 999,
    boxShadow: "0 0 22px rgba(0,183,255,0.95)",
  },
  fieldRadarDot: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    border: "4px solid rgba(255,255,255,0.96)",
    zIndex: 5,
  },
  fieldRadarLabel: {
    position: "absolute",
    transform: "translate(-50%, 22px)",
    fontSize: 18,
    fontWeight: 1000,
    textShadow: "0 2px 10px rgba(0,0,0,1)",
    zIndex: 6,
  },
  fieldMainGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
    marginBottom: 12,
  },
  fieldBigBox: {
    background: "#11162c",
    borderRadius: 16,
    padding: 16,
    textAlign: "center",
    display: "grid",
    gap: 6,
  },
  fieldInstructionGood: {
    background: "rgba(21,255,49,0.12)",
    color: "#15ff31",
    border: "1px solid rgba(21,255,49,0.35)",
    borderRadius: 16,
    padding: 16,
    fontSize: 30,
    fontWeight: 1000,
    textAlign: "center",
    marginBottom: 12,
  },
  fieldInstructionBad: {
    background: "rgba(255,102,102,0.12)",
    color: "#ff6666",
    border: "1px solid rgba(255,102,102,0.35)",
    borderRadius: 16,
    padding: 16,
    fontSize: 28,
    fontWeight: 1000,
    textAlign: "center",
    marginBottom: 12,
  },
  fieldTimeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10,
    marginBottom: 12,
  },
  fieldTimeBox: {
    background: "#11162c",
    borderRadius: 14,
    padding: 14,
    display: "grid",
    gap: 6,
    textAlign: "center",
  },
  fieldTimeLabel: {
    color: "#a9adbd",
    fontSize: 15,
    fontWeight: 1000,
    letterSpacing: 1,
  },
  fieldTimeValue: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: 1000,
  },
  fieldCompassButton: {
    width: "100%",
    background: "#00b7ff",
    color: "#00111a",
    border: 0,
    borderRadius: 14,
    padding: "16px 14px",
    fontSize: 18,
    fontWeight: 1000,
    marginTop: 8,
  },
  fieldAxis: {
    background: "rgba(0,183,255,0.10)",
    color: "#00b7ff",
    border: "1px solid rgba(0,183,255,0.35)",
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    fontWeight: 1000,
    textAlign: "center",
    marginTop: 12,
  },
  solarSafeCard: {
    background: "#21192c",
    border: "2px solid rgba(255,90,90,0.45)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    boxShadow: "0 0 30px rgba(255,90,90,0.08)",
  },
  disabledGuideCard: {
    background: "#171b33",
    border: "2px solid rgba(255,212,0,0.35)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
  },
  solarTitle: {
    color: "#ff7777",
    fontSize: 30,
    fontWeight: 1000,
    textAlign: "center",
    marginBottom: 12,
  },
  disabledGuideTitle: {
    color: "#ffd400",
    fontSize: 28,
    fontWeight: 1000,
    textAlign: "center",
    marginBottom: 12,
  },
  solarText: {
    color: "#e8eaf5",
    fontSize: 16,
    lineHeight: 1.45,
    fontWeight: 800,
    textAlign: "center",
  },
  solarGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 10,
    marginTop: 14,
    marginBottom: 14,
  },
  solarMetric: {
    background: "#11162c",
    borderRadius: 12,
    padding: 12,
    display: "grid",
    gap: 4,
    textAlign: "center",
  },
  sectionTitle: {
    margin: "0 0 16px",
    fontSize: 22,
    color: "#ffffff",
    textAlign: "center",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  infoBox: {
    background: "#11162c",
    borderRadius: 12,
    padding: 12,
  },
  infoLabel: {
    color: "#9ca3b7",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 4,
  },
  infoValue: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: 800,
  },
  buttonRow: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
    marginTop: 16,
  },
  primaryButton: {
    background: "#00b7ff",
    color: "#00111a",
    border: 0,
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 18,
    fontWeight: 900,
  },
  yellowButton: {
    background: "#ffd400",
    color: "#090909",
    border: 0,
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 18,
    fontWeight: 900,
  },
  secondaryButton: {
    background: "#707070",
    color: "#ffffff",
    border: 0,
    borderRadius: 12,
    padding: "15px 18px",
    fontSize: 18,
    fontWeight: 900,
  },
  disabledButton: {
    opacity: 0.45,
  },
  sunWarning: {
    background: "rgba(255,90,90,0.14)",
    color: "#ff7777",
    border: "1px solid rgba(255,90,90,0.45)",
    borderRadius: 12,
    padding: 12,
    fontWeight: 900,
    marginTop: 14,
    lineHeight: 1.4,
    textAlign: "center",
  },
  targetName: {
    textAlign: "center",
    fontSize: 25,
    marginBottom: 14,
    color: "#ffffff",
  },
  lockText: {
    color: "#15ff31",
    textAlign: "center",
    fontSize: 42,
    fontWeight: 1000,
    margin: "18px 0",
  },
  precisionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 14,
  },
  directionBox: {
    background: "#11162c",
    borderRadius: 14,
    padding: 16,
    textAlign: "center",
  },
  bigYellow: {
    color: "#ffd400",
    fontSize: 30,
    fontWeight: 1000,
    lineHeight: 1.1,
  },
  okText: {
    color: "#15ff31",
    fontSize: 28,
    fontWeight: 1000,
    lineHeight: 1.1,
  },
  metric: {
    color: "#a9adbd",
    fontSize: 17,
    fontWeight: 800,
    marginTop: 8,
  },
  lockGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    marginTop: 16,
  },
  greenBadge: {
    background: "rgba(21,255,49,0.12)",
    color: "#15ff31",
    padding: 10,
    borderRadius: 10,
    textAlign: "center",
    fontWeight: 900,
  },
  redBadge: {
    background: "rgba(255,92,92,0.12)",
    color: "#ff6666",
    padding: 10,
    borderRadius: 10,
    textAlign: "center",
    fontWeight: 900,
  },
  label: {
    display: "block",
    fontSize: 18,
    fontWeight: 900,
    marginBottom: 10,
  },
  select: {
    width: "100%",
    background: "#1b203a",
    color: "#ffffff",
    border: "2px solid #00b7ff",
    borderRadius: 12,
    padding: 15,
    fontSize: 18,
    fontWeight: 800,
  },
  tableCard: {
    background: "#11162c",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 18,
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr 0.9fr 1.2fr",
    gap: 8,
    padding: "14px 12px",
    background: "#1b203a",
    color: "#ffffff",
    fontWeight: 900,
    fontSize: 14,
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr 0.9fr 1.2fr",
    gap: 8,
    width: "100%",
    padding: "16px 12px",
    background: "transparent",
    border: 0,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    color: "#e8eaf5",
    fontSize: 15,
    fontWeight: 800,
    textAlign: "left",
  },
  selectedRow: {
    background: "#303755",
  },
  smallText: {
    color: "#a9adbd",
    fontSize: 15,
    lineHeight: 1.4,
  },
  planList: {
    display: "grid",
    gap: 12,
    marginTop: 14,
  },
  planItem: {
    background: "#11162c",
    color: "#f3f5ff",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 14,
    textAlign: "left",
  },
  selectedPlanItem: {
    border: "1px solid rgba(255,212,0,0.65)",
    boxShadow: "0 0 24px rgba(255,212,0,0.12)",
  },
  planTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 22,
    marginBottom: 10,
  },
  planGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    color: "#c8ccda",
    fontSize: 14,
    fontWeight: 800,
  },
  planAdvice: {
    marginTop: 10,
    color: "#ffd400",
    fontWeight: 800,
    fontSize: 14,
    lineHeight: 1.35,
  },
  statusGood: {
    color: "#15ff31",
    fontWeight: 1000,
  },
  statusMedium: {
    color: "#ffd400",
    fontWeight: 1000,
  },
  statusBad: {
    color: "#ff6666",
    fontWeight: 1000,
  },
  statusSolar: {
    color: "#ff9966",
    fontWeight: 1000,
  },
  arCard: {
    background: "#10162d",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    border: "1px solid rgba(0,183,255,0.35)",
  },
  disabledArCard: {
    background: "#11162c",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    border: "1px solid rgba(255,90,90,0.35)",
    opacity: 0.95,
  },
  noticeBox: {
    background: "rgba(255,212,0,0.12)",
    color: "#ffd400",
    border: "1px solid rgba(255,212,0,0.35)",
    borderRadius: 12,
    padding: 12,
    fontWeight: 800,
    marginBottom: 12,
    lineHeight: 1.4,
  },
  arFrame: {
    position: "relative",
    marginTop: 16,
    background: "#000",
    borderRadius: 18,
    overflow: "hidden",
    minHeight: 360,
    border: "2px solid rgba(255,255,255,0.12)",
  },
  arVideo: {
    width: "100%",
    height: 420,
    display: "block",
    objectFit: "cover",
  },
  cameraPlaceholder: {
    height: 420,
    display: "grid",
    placeItems: "center",
    color: "#8d93aa",
    fontWeight: 900,
    fontSize: 18,
  },
  arOverlay: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  },
  reticle: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 96,
    height: 96,
    transform: "translate(-50%, -50%)",
    border: "2px solid rgba(255,255,255,0.75)",
    borderRadius: "50%",
    boxShadow: "0 0 24px rgba(255,255,255,0.25)",
  },
  reticleH: {
    position: "absolute",
    left: -28,
    right: -28,
    top: "50%",
    height: 2,
    background: "rgba(255,255,255,0.75)",
  },
  reticleV: {
    position: "absolute",
    top: -28,
    bottom: -28,
    left: "50%",
    width: 2,
    background: "rgba(255,255,255,0.75)",
  },
  marker: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    display: "grid",
    placeItems: "center",
    gap: 6,
  },
  markerOffscreen: {
    opacity: 0.75,
  },
  markerDot: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "4px solid #ffd400",
    boxShadow: "0 0 24px rgba(255,212,0,0.9)",
    background: "rgba(255,212,0,0.15)",
  },
  markerLabel: {
    color: "#ffd400",
    fontSize: 15,
    fontWeight: 1000,
    textShadow: "0 2px 8px rgba(0,0,0,0.9)",
  },
  arInstruction: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    display: "grid",
    gap: 6,
    background: "rgba(0,0,0,0.65)",
    borderRadius: 14,
    padding: 14,
    color: "#ffd400",
    fontSize: 20,
    fontWeight: 1000,
    textAlign: "center",
  },
  arPreviewText: {
    color: "#ffd400",
    fontSize: 24,
    fontWeight: 1000,
  },
  arInfoGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8,
    marginTop: 12,
  },
  arMiniMetric: {
    background: "#11162c",
    borderRadius: 10,
    padding: 10,
    color: "#e8eaf5",
    fontWeight: 900,
    textAlign: "center",
  },
  error: {
    color: "#ff6666",
    fontWeight: 800,
    marginTop: 12,
  },
};