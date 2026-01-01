import type { Camera } from "../types";

export const WALKING_STREAM_FILES: string[] = [
  "Shibuya Crossing, Tokyo, Japan (video).webm",
  "Sabana Grande Caracas. People walking on the Boulevard of Sabana Grande, famous in Caracas, Venezuela.webm",
  "Boulevard of Sabana Grande in Caracas.webm",
  "DiagonalCrosswalkYongeDundas.webm",
  "Scramble Crossing at Robinson Road in Singapore - September 2022.webm",
  "Timelapse Calle Francisco I. Madero (Ciudad de México).webm",
  "Road traffic on Stritarjeva street.webm",
  "VIDEO - Sunset - Le Suquet (Old Town).webm",
  "Werkzaamheden Industrieplein Weurt afgerond.webm",
  "Werkzaamheden Indrapoera.webm",
  "Crosswalk at San José International Airport Consolidated Rental Car Facility exit.webm",
  "Crosswalk occupying at the We Will Not Stop! protest.webm",
  "Explore Shanghai's Most Famous Shopping Street at Night on Foot - China Walking Tour.webm",
  "Cruce peatonal de Eje Central Lázaro Cárdenas y Avenida Madero, Ciudad de México.webm",
  "Walk inside La Galerie Vivienne in Paris, November 7, 2024.webm",
  "Walk inside Le Passage de Choiseul in Paris, November 7, 2024.webm",
  "Walking in City Centre of Tehran - Valiasr Crossroads to College Bridge.webm",
  "Walking China - A Short Stroll Along Nanjing Road, THE Most Famous Shopping Street in Shanghai.webm",
  "Walking China, TaiCang, a Newly Developed Satellite city near Shanghai.webm",
];

export const DEMO_STREAMS: string[] = WALKING_STREAM_FILES.map(
  (name) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}`
  //(name) => `https://commons.wikimedia.org/wiki/${encodeURIComponent(name)}`
);

// 19 cameras that take URLs
export const CAMERAS: Camera[] = Array.from({ length: 6 }).map((_, i) => {
  const n = (i + 1).toString().padStart(2, "0");
  return {
    id: `cam-${n}`,
    name: `Cam ${100 + i + 1}`,
    streamUrl: i === 0 ? "/streams/patient_fall.mp4" : DEMO_STREAMS[i % DEMO_STREAMS.length] // reuse across tiles
  };
});

/**
 * Put your real stream URLs here.
 * Example:
 * { id: "cam-01", name: "Cam 101", streamUrl: "https://.../stream.mp4" }
 
export const CAMERAS: Camera[] = Array.from({ length: 19 }).map((_, i) => {
  const n = (i + 1).toString().padStart(2, "0");
  return { id: `cam-${n}`, name: `Cam ${100 + i + 1}` };
});
*/

export const WEBCAM_CAMERA: Camera = { id: "webcam", name: "Operator Webcam" };
