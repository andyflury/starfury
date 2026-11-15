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
