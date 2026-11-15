/** Stage 1, liftoff. Throttle levels are 0 to 1, times seconds, angles degrees, distances metres. */
export const LIFTOFF = {
  /** First number of the countdown. */
  countdownFrom: 10,
  /** Seconds between repeats of a waiting prompt. */
  promptRepeat: 8,
  /** Throttle at or below this counts as fully down. */
  throttleDown: 0.05,
  /** Seconds the throttle must stay down before the countdown starts. */
  throttleDownHold: 0.3,
  /** Countdown number from which the pad steam builds. */
  steamFrom: 3,
  /** Throttle above this before T-0 is a false start. */
  falseStartThrottle: 0.15,
  /** Throttle at or above this lifts the rocket off. */
  liftoffBand: 0.85,
  /** Seconds after T-0 within which the throttle must reach the band. */
  bandDeadline: 4,
  /** Upward acceleration at full throttle, m/s². */
  climbAccel: 2.4,
  /** Throttle at which the rocket neither climbs nor sinks. */
  hoverThrottle: 0.55,
  /** Vertical speed decay per second. */
  climbDrag: 0.05,
  /** Height of the rocket's base above the pad when it passes the tower top. */
  towerClearHeight: 122,
  /** Tilt beyond this while beside the tower is a crash. */
  crashTilt: 25,
  /** Tilt the rocket never exceeds. */
  maxTilt: 40,
  /** Fraction of the crash tilt at which the tilt warning plays. */
  warnFraction: 0.6,
  /** Seconds between tilt warnings at least. */
  warnCooldown: 6,
  /** Tilt rate per degree of tilt, the tilt's tendency to grow by itself, 1/s. */
  tiltGrowth: 0.08,
  /** Tilt rate at full stick, degrees per second. */
  stickRate: 10,
  /** Sideways drift speed per vertical speed per radian of tilt. */
  drift: 0.4,
  /** Distance the rocket sidesteps away from the tower after liftoff, metres along +X. */
  sidestep: 18,
  /** Seconds over which the sidestep happens. */
  sidestepSeconds: 3,
  /** Seconds after liftoff before the first gust. */
  firstGust: 1.5,
  /** Peak tilt rate of a gust, lowest and highest, degrees per second. */
  gustRate: [3.2, 6] as const,
  /** Length of a gust, shortest and longest. */
  gustSeconds: [2, 3.5] as const,
  /** Calm between gusts, shortest and longest. */
  gustGap: [0.8, 2.5] as const,
  /** Largest angle between a gust and +X, the direction away from the tower, degrees. */
  gustSpread: 40,
  /** Seconds of climb from liftoff to stage complete at full throttle. */
  climbSeconds: 22,
  /** Seconds from T-0 to the band within which the throttle counts as quick. */
  quickBand: 2,
  /** Largest tilt for 3 stars. */
  smallTilt: 9,
  /** Largest tilt for 2 stars. */
  moderateTilt: 16,
};

/** Stage 2, booster catch. Distances metres, speeds metres per second, angles degrees. */
export const CATCH = {
  /** Height of the booster's base above the ground at the start. */
  startHeight: 800,
  /** Vertical speed below this at the catch point is a soft catch. */
  softSpeed: 3,
  /** Vertical speed below this at the catch point is a hard catch; at or above it a crash. */
  hardSpeed: 6,
  /** Tilt at or above this at the catch point is a crash. */
  maxTilt: 10,
  /** The assist acts inside this many catch-box widths of the tower's axis. */
  assistRadiusFactor: 1.5,
  /** Fuel level at which the low-fuel warning plays. */
  lowFuel: 0.2,

  /** Horizontal distance of the booster from the tower's axis at the start. */
  startOffset: 200,
  /** The start direction lies within this angle either side of +X, picked at random. */
  startSpread: 35,
  /** Descent speed at the start. */
  startDescent: 20,

  /** Descent speed the booster settles to at zero throttle. */
  fallSpeed: 40,
  /** Throttle at which the booster hovers. */
  hoverThrottle: 0.65,
  /** Climb speed the booster settles to at full throttle. */
  climbSpeed: 4,
  /** Seconds the vertical speed takes to settle towards the throttle's speed (time constant). */
  speedLag: 1,
  /** Downward acceleration never exceeds this, m/s². */
  gravity: 9.8,
  /** Seconds of full throttle in a full tank. */
  fuelSeconds: 65,

  /** Horizontal acceleration at full stick, m/s². */
  stickAccel: 5,
  /** Horizontal velocity decay per second. */
  damping: 0.5,
  /** Lean of the booster per m/s of horizontal speed. */
  tiltPerSpeed: 2.5,
  /** Assist pull towards the axis per metre of offset, m/s². */
  assistPull: 0.15,
  /** The assist pull never exceeds this share of `stickAccel`. */
  assistMaxShare: 0.25,
  /** Extra horizontal velocity decay per second inside the assist radius. */
  assistDamping: 0.8,
  /** Beyond this horizontal distance from the axis the booster is pushed back. */
  areaRadius: 400,

  /** The catch box reaches this far from the axis towards the tower (-X). */
  boxBack: 7,
  /** The catch box reaches this far from the axis away from the tower (+X). */
  boxFront: 8,
  /** Clearance between the hull and the open arms at the edge of the catch box. */
  boxMargin: 1,
  /** A catch within this horizontal distance of the axis counts as centred. */
  centreRadius: 3,

  /** Seconds of reaction the speed light allows for before full braking. */
  brakeReaction: 1.5,
  /** The speed light is yellow while the height left is less than this many braking distances. */
  yellowFactor: 2,
  /** Below this height of the pins above the catch point the speed light shows the catch thresholds. */
  finalHeight: 30,
  /** Seconds between two `slower` warnings at least. */
  slowerEvery: 5,
  /** Seconds without sinking, with the pins above `approachHeight`, before the `descend` prompt. */
  stallSeconds: 3,
  /** Descent speed below which the booster counts as not sinking. */
  stallSpeed: 1,
  /** Seconds between two `descend` prompts at least. */
  descendEvery: 8,

  /** Throttle at or above which the three centre engines light. */
  engineLow: 0.05,
  /** Throttle at or above which thirteen engines light. */
  engineHigh: 0.5,
  /** Seconds the arms take to close on a caught booster. */
  closeSeconds: 0.8,
  /** Seconds after an ending's voice line before the result is set. */
  endPause: 0.5,
  /** Camera shake of a hard catch, 0 to 1. */
  hardShake: 0.6,

  /** Chase view: the camera stands behind (+Z) and above the booster's top at this many degrees above horizontal. */
  chaseElevation: 35,
  /** Chase view: booster and catch point stay between these screen heights (-1 bottom to 1 top). */
  chaseTop: 0.85,
  chaseBottom: -0.85,
  /** Chase view: booster and catch point stay within this share of the half screen width, clear of the side bars. */
  chaseSideMargin: 0.6,
  /** Chase view: the camera comes no closer to the booster's top than this. */
  chaseMinDistance: 120,
  /** Below this height of the pins above the catch point the camera blends into the drone view. */
  approachHeight: 150,
  /** The drone view applies fully within this horizontal distance of the axis and fades out by twice it. */
  droneRadius: 60,
  /** Drone view: degrees the camera looks down at its aim point. */
  droneElevation: 40,
  /** Drone view: distance from the aim point with the pins at the catch point, and extra per metre of pin height above it. */
  droneDistance: 120,
  droneDistancePerHeight: 0.6,
  /** Drone view: the aim point lies this share of the way from the catch point to the booster's centre. */
  droneAim: 0.4,
  /** Drone view: degrees it swings around the tower's axis, from the +Z side (0) towards the +X side. */
  droneSweep: 90,
  /** Drone view: peak swing speed, degrees per second, easing to rest at both ends. */
  droneSpeed: 6,
  /** The target ring keeps its true size within this distance of the camera and grows with distance beyond it. */
  ringScaleDistance: 150,
  /** Exhaust level at the lowest throttle that lights the engines; it rises linearly to 1 at full throttle. */
  exhaustMin: 0.65,
};

/**
 * Max-Q ascent. Distances metres along the flight path or across it, speeds metres per second, times seconds. Air
 * pressure is 1 at the most the rocket takes.
 */
export const MAXQ = {
  /** Length of the flight path from the start to the last ring. */
  length: 4200,
  /** Speed along the path at full throttle. */
  topSpeed: 110,
  /** Share of `topSpeed` the rocket keeps at zero throttle; the rest grows linearly with the throttle. */
  idleShare: 0.3,
  /** Seconds the speed takes to settle towards the throttle's speed (time constant). */
  speedLag: 1.2,

  /** Air pressure at full speed at the start, at the peak and at the end of the path. */
  densityStart: 0.3,
  densityPeak: 1.0,
  densityEnd: 0.15,
  /** Share of the path at which the air pressure at full speed peaks. */
  peakAt: 0.4,
  /** Pressure from which the bar is red. */
  red: 0.8,
  /** Full-speed pressure, rising, at which `maxq_ease` plays and the band window shows. */
  easeAt: 0.42,
  /** Full-speed pressure, falling, at which `maxq_full` plays and the band window goes. */
  fullAt: 0.72,
  /** The band window on the throttle bar. */
  bandFrom: 0.45,
  bandTo: 0.65,
  /** Seconds of one spell in the red before `maxq_overload`, and between repeats while it lasts. */
  overloadAfter: 1,
  overloadRepeat: 3,
  /** Total seconds in the red at which the rocket breaks up. */
  stressLimit: 4,

  /** Number of rings and the path distance of the first; the last stands at the end of the path. */
  rings: 8,
  firstRing: 420,
  /** Radius of a ring; the rocket's axis passing within it counts as flying through. */
  ringRadius: 30,
  /** Each ring's centre is this far across the path from the previous one's, shortest and longest. */
  ringStep: [28, 45] as const,
  /** No ring's centre is further than this from the path's centre line. */
  ringSpread: 70,
  /** Speed across the path at full stick. */
  stickSpeed: 24,
  /** Seconds the speed across the path takes to follow the stick (time constant). */
  stickLag: 0.5,
  /** The rocket never strays further than this from the path's centre line. */
  maxOffset: 110,
  /** Degrees the path turns from upright, at the start and at the end, towards the sea (-Z). */
  pitchStart: 50,
  pitchEnd: 75,
  /** Height of the path's start above the launch mount. */
  startHeight: 2000,

  /** Camera: distance behind the rocket's middle along the path, to its left, and above it across the path. */
  cameraBack: 185,
  cameraSide: 68,
  cameraRise: 110,
  /** Camera: it looks at the point this far ahead of the rocket's middle along the path. */
  cameraAhead: 85,
  /** Camera: seconds its sideways follow of the rocket lags behind (time constant). */
  cameraLag: 0.8,
  /** Camera shake per second at pressure 1, and extra while in the red. */
  shake: 0.25,
  redShake: 0.5,
  /** Pressure from which the vapour collar forms; it is full at the red. */
  vaporFrom: 0.3,
  /** Sky altitude at the start and at the end of the path. */
  skyStart: 0.1,
  skyEnd: 0.6,
  /** Seconds after an ending's voice line before the result is set. */
  endPause: 0.5,

  /** Rings missed at most, and seconds in the red at most, for 3 stars. */
  missesFor3: 1,
  redFor3: 0.4,
  /** Rings flown through at least, and seconds in the red at most, for 2 stars. */
  hitsFor2: 5,
  redFor2: 3,
  /** Seconds after which finishing caps the result at 2 stars. */
  timeLimit: 56,
};

/** Hot staging. Throttle levels are 0 to 1, times seconds, distances metres. */
export const STAGING = {
  /** Seconds between repeats of the throttle-down prompt. */
  promptRepeat: 8,
  /** Seconds after the throttle-down prompt before the count may begin. */
  promptSeconds: 4.6,
  /** Throttle at or below this counts as down. */
  throttleLow: 0.1,
  /** Seconds the throttle must stay down before the count begins. */
  throttleLowHold: 0.3,
  /** Throttle above this during the count stops it and asks for the throttle down again. */
  countThrottle: 0.3,
  /** Seconds from the count's prompt to its first number. */
  countLead: 2.6,
  /** First number of the count; one number per second down to zero. */
  countFrom: 3,
  /** Seconds before zero beyond which a flip is too early. Flips before the first number are ignored. */
  earlyLimit: 1.2,
  /** Seconds after zero without a flip before the separation fails. */
  lateLimit: 1.6,
  /** Largest timing error for 3 stars. */
  threeStarError: 0.35,
  /** Largest timing error for 2 stars. */
  twoStarError: 0.8,
  /** Throttle at or above this pulls the ship away. */
  fullThrottle: 0.85,
  /** Seconds after the flip within which the throttle must reach `fullThrottle`. */
  throttleDeadline: 3,
  /** Throttle reaching `fullThrottle` later than this after the flip caps the stars at 2. */
  quickThrottle: 1.5,
  /** Highest gap between the stages before the ship sinks back, reached halfway to the deadline. */
  hopHeight: 6,
  /** Acceleration of the gap once the ship pulls away, m/s². */
  pullAccel: 14,
  /** Seconds of pulling away before the stage completes. */
  pullSeconds: 3,
  /** Seconds after an ending's voice line before the result is set. */
  endPause: 0.5,

  /** Sky altitude of the whole stage. */
  skyAltitude: 0.65,
  /** Height of the booster's base at the start. */
  startHeight: 1500,
  /** Climb speed of the stack and of the ship after separation, m/s. */
  climbSpeed: 60,
  /** Camera distance from the join, horizontal, and how far below it the camera sits. */
  cameraDistance: 68,
  cameraBelow: 30,
  /** While the throttle comes down the camera looks level at this height above the booster's base, from this distance. */
  engineViewLook: 32,
  engineViewDistance: 150,
  /** Rate per second of the camera's move between the engine view and the join. */
  focusRate: 0.6,
  /** The camera looks this share of its distance left of the stack, so the stack stands right of the count digit. */
  cameraShift: 0.22,
  /** The camera's bearing from the stack, radians from +Z towards +X. */
  cameraYaw: 0.5,
  /** After success the camera looks this far up the ship and stands this much further back. */
  successLook: 25,
  successPullBack: 40,
  /** Flash size in metres and seconds to fade. */
  flashSize: 55,
  flashFade: 0.8,
  /** Seconds the fire vents from the ring after the flip. */
  ventSeconds: 1.6,
  /** Seconds after the flip at which the booster's engines go out. */
  boosterCutoff: 0.5,
  /** Shake at the flip, 0 to 1. */
  flipShake: 0.45,
};

/** Starlink deploy. Angles degrees, times seconds, distances metres. */
export const DEPLOY = {
  /** Satellites aboard at the start. */
  satellites: 5,
  /** Seconds from the start, while the door opens and the voice explains, before releases are possible. */
  introSeconds: 7,
  /** Seconds the payload door takes to open, and to close at the end. */
  doorSeconds: 3,
  /** Seconds from the end of the intro until the release window closes. */
  windowSeconds: 45,
  /** Seconds after a release before the next one is possible. */
  reloadSeconds: 1.5,
  /** Attitude error at or below this at release sends a satellite out well. */
  releaseLimit: 7,
  /** The attitude error never exceeds this. */
  maxTilt: 16,
  /** The ship is drawn leaning this many times the attitude error, so an error outside the release limit is plain to see. */
  leanScale: 2.5,
  /** Turn rate at full stick, degrees per second. */
  stickRate: 5,
  /** Drift rate of the attitude, lowest and highest, degrees per second. */
  driftRate: [0.25, 0.5] as const,
  /** Fastest turn of the drift's direction, degrees per second. */
  driftTurn: 25,
  /** Share of the drift and the kicks that turns the ship towards or away from the camera, where a lean cannot be seen; the rest leans it left or right on screen. */
  depthShare: 0,
  /** Seconds between changes of the drift's turn, shortest and longest. */
  driftChange: [2, 4] as const,
  /** Attitude change each release adds in total, degrees. */
  kick: 4.8,
  /** Time constant over which a kick's turn fades. */
  kickSeconds: 0.35,
  /** A kick's direction lies within this angle either side of the run's recoil direction, screen left or right. */
  kickSpread: 35,
  /** Seconds from the last release or the window's close until the door starts closing. */
  doorDelay: 1,
  /** Seconds from the last release or the window's close to the ending's voice line. */
  finishSeconds: 3,
  /** Seconds after an ending's voice line before the result is set. */
  endPause: 0.5,

  /** Satellite slab: clearance to the slot's edges across it, thickness as a share of the slot's height, and depth out of the slot. */
  slotMargin: 0.3,
  slabThickness: 0.3,
  slabDepth: 2.6,
  /** Distance past the hull at which a sliding slab is free of the ship. */
  clearance: 0.3,
  /** Speed at which a slab slides out and drifts away, metres per second. */
  exitSpeed: 3,
  /** A lost slab's speed, its swerve sideways from the slot's direction in degrees, its tumble in degrees per second, and the seconds after it is free before it tumbles. */
  lostSpeed: 4,
  lostSwerve: 40,
  lostSpin: 120,
  lostSpinDelay: 0.6,

  /** Camera distance from its aim, which lies this far above the slot and this far out from the ship's axis along the slot's direction. */
  cameraDistance: 45,
  cameraAimUp: 1,
  cameraAimOut: 6,
  /** Degrees the camera looks down on the ship. */
  cameraElevation: 32,
  /** Degrees the camera stands around the ship from the slot's direction, towards the ship's local +X. */
  cameraSide: 50,
  /** Degrees the camera swings either side, and the seconds of one full swing. */
  cameraSwing: 8,
  cameraSwingSeconds: 40,
};

/** Re-entry. Times seconds of stage time, angles degrees, heat 0 cool to 1 burning up. */
export const REENTRY = {
  /** The intensity rises from 0 at `glowFrom`, is full from `peakFrom` to `peakTo` and falls to 0 at `fadeTo`, where the stage ends. */
  glowFrom: 3,
  peakFrom: 16,
  peakTo: 22,
  fadeTo: 40,

  /** Peak attitude-error rate of a shove at full intensity, on roll and pitch together, lowest and highest, degrees per second. */
  shoveRate: [4, 7] as const,
  /** Length of a shove, shortest and longest. */
  shoveSeconds: [2, 4] as const,
  /** Calm between shoves, shortest and longest. */
  shoveGap: [0.8, 2.5] as const,
  /** Error rate per degree of error at full intensity, the error's tendency to grow by itself, 1/s. */
  errorGrowth: 0.14,
  /** Roll or pitch rate at full stick on that axis, degrees per second. */
  stickRate: 14,
  /** The error, roll and pitch together, never exceeds this; the rim of the tilt level. */
  maxError: 45,

  /** Error beyond which the heat climbs fast; the green middle of the tilt level. */
  limit: 20,
  /** Heating per second at full intensity with no error. */
  heatBase: 0.035,
  /** Extra heating per second at full intensity per (error / `limit`)². */
  heatError: 0.12,
  /** Heat lost per second per unit of heat. */
  cooling: 0.08,
  /** Heat at or above which `reentry_hot` plays. */
  hotHeat: 0.7,
  /** Seconds between two `reentry_hot` at least. */
  hotEvery: 5,
  /** Highest heat below which the run earns 3 stars, and 2 stars. */
  threeStarHeat: 0.5,
  twoStarHeat: 0.8,

  /** Engine-sound level of the roar at full intensity. */
  roar: 0.35,
  /** Camera shake added per second at full intensity. */
  shake: 0.25,
  /** Seconds after an ending's voice line before the result is set. */
  endPause: 0.5,
  /** Flap travel at full pitch stick, 0 to 1. */
  flapTravel: 0.8,
  /** Rate per second at which the flaps follow the stick. */
  flapRate: 4,

  /** Camera: distance from the ship's centre, degrees above the horizontal, and bearing from +X towards +Z. */
  cameraDistance: 68,
  cameraElevation: 7,
  cameraBearing: 20,
  /** Camera: degrees the bearing sways either way, and seconds of one full sway. */
  cameraSway: 18,
  cameraSwayPeriod: 30,
  /** Camera: metres below the ship's centre it looks at. */
  cameraLookBelow: 6,
};

/** Ship catch: what differs from `CATCH`. Heights of the flip are of the pins above the catch point. */
export const SHIP_CATCH = {
  /** Height of the ship's base above the ground at the start. */
  startHeight: 700,
  /** Horizontal distance of the ship from the tower's axis at the start. */
  startOffset: 150,
  /** Descent speed of the belly-flop, held from the start until the flip. */
  startDescent: 25,
  /** Seconds of full throttle in a full tank. */
  fuelSeconds: 25,
  /** Fuel level at which the low-fuel warning plays. */
  lowFuel: 0.1,
  belly: {
    /** Throttle above this starts the flip. */
    flipThrottle: 0.3,
    /** Seconds the flip from horizontal to upright takes. */
    flipSeconds: 2,
    /** Top of the comfortable flip range: the `ship_flip` prompt plays here, and the speed light turns yellow. */
    flipTop: 250,
    /** Bottom of the comfortable flip range: the speed light turns red. */
    flipBottom: 120,
    /** The `ship_flip` prompt plays again this far below `flipTop`. */
    flipRepeatDrop: 80,
    /** Flap spread in the belly-flop, and its change per unit of stick towards the tail (+X), forward flaps spreading. */
    flapSpread: 0.8,
    flapStick: 0.4,
  },
};
