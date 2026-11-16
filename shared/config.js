// Shared definitions: imported by BOTH the server (authoritative) and the browser client.
export const START_CASH = 1000;
export const MAX_PLAYERS = 8;
const L = [-160, -80, 0, 80, 160];
export const ROAD = { lines: L, width: 14, extent: 200 };
export const BLOCKS = [-120, -40, 40, 120];
export const SPAWN = { x: 6, z: 6 };
export const POINTS = L.flatMap(x => L.map(z => ({ x, z })));
export const PAINTS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0xffffff, 0x212121, 0x8e24aa, 0xfb8c00, 0x9e9e9e];
export const PAINT_COST = 100;

export const VEHICLES = {
  sedan:     { name: 'BMW 1 Series M',        price: 0,       maxSpeed: 40, accel: 13, brake: 32, turn: 0.58, size: [1.9, 1.43, 4.34],  cabin: 0.5, weight: 1500, color: 0x1e88e5, model: 'bmw1m' },
  suv:       { name: 'Mercedes-Benz GLS 580', price: 35000,   maxSpeed: 38, accel: 11, brake: 30, turn: 0.50, size: [2.11, 1.8, 5.13], cabin: 0.6, weight: 2500, color: 0x222222, model: 'gls' },
  sports:    { name: 'Nissan GT-R R35',       price: 40000,   maxSpeed: 58, accel: 20, brake: 38, turn: 0.60, size: [2.13, 1.36, 4.71], cabin: 0.5, weight: 1740, color: 0xdddddd, model: 'gtr' },
  senna:     { name: 'McLaren Senna',         price: 900000,  maxSpeed: 70, accel: 26, brake: 44, turn: 0.64, size: [2.16, 1.23, 4.75], cabin: 0.5, weight: 1200, color: 0xffb300, model: 'senna' },
  laferrari: { name: 'LaFerrari',             price: 1800000, maxSpeed: 74, accel: 28, brake: 44, turn: 0.64, size: [2.38, 1.23, 4.70], cabin: 0.5, weight: 1255, color: 0xe53935, model: 'laferrari' },
  agera:     { name: 'Koenigsegg Agera',      price: 2500000, maxSpeed: 78, accel: 30, brake: 45, turn: 0.64, size: [2.1, 1.13, 4.28],  cabin: 0.5, weight: 1330, color: 0xffffff, model: 'agera' },
  hyper:     { name: 'Bugatti Chiron',        price: 4000000, maxSpeed: 84, accel: 31, brake: 46, turn: 0.62, size: [2.5, 1.06, 4.54],  cabin: 0.5, weight: 1995, color: 0x1b3a8a, model: 'chiron' },
};

const sp = (id, label, x, z, w, d, h, color) => ({ id, label, x, z, w, d, h, color, ix: x, iz: z + d / 2 + 2.5 });
export const SPECIAL = [
  sp('dealer', 'Vehicle Dealership', -40, -40, 34, 22, 9, 0x2f80ed),
  sp('jobs', 'Job Center', 40, -40, 26, 20, 10, 0xf2994a),
  sp('mart', 'Valley Life Mart', -120, -120, 36, 24, 9, 0xf59e0b),
  sp('police', 'Police Station', -120, -40, 30, 24, 10, 0x3a4a8c),
  sp('hospital', 'Hospital', 120, -40, 34, 28, 16, 0xe8eef5),
  sp('grocery', 'Grocery Store', -120, 40, 32, 22, 8, 0x6fcf97),
  sp('gas', 'Gas Station', -40, 40, 16, 12, 5, 0xeb5757),
  sp('mechanic', "Brad's Shop", 40, 40, 24, 18, 7, 0x828282),
  sp('cafe', 'Cafe', 120, 40, 20, 16, 7, 0xbb6bd9),
];

const hs = (id, name, price, x, z, face, color) => ({ id, name, price, x, z, face, w: 14, d: 12, color, dx: x, dz: z + face * 8 });
export const HOUSES = [
  hs('h1', 'Maple Cottage', 6000, -120, 100, -1, 0xd9a066),
  hs('h2', 'Oak Bungalow', 8500, -120, 140, 1, 0x9fc5a0),
  hs('h3', 'Willow House', 12000, -40, 100, -1, 0xe8d8b0),
  hs('h4', 'Birch Villa', 18000, -40, 140, 1, 0xb6c6e0),
  hs('h5', 'Cedar Lodge', 25000, 40, 100, -1, 0xc58b6b),
  hs('h6', 'Aspen Manor', 40000, 40, 140, 1, 0xd8d8d8),
  hs('h7', 'Harbor Home', 55000, 120, 100, -1, 0x8fb8c9),
  hs('h8', 'Summit Estate', 90000, 120, 140, 1, 0xe0b0b0),
];

export const JOBS = {
  civilian: { name: 'Civilian', desc: 'No job. Explore, drive, own houses and hang out with friends.' },
  delivery: { name: 'Delivery Driver', desc: 'Collect a package, then deliver it to the drop-off by vehicle.', base: 80, perUnit: 0.9, pickupInVehicle: false, pickupText: 'Pick up the package', dropText: 'Deliver the package' },
  taxi: { name: 'Taxi Driver', desc: 'Drive to the passenger, then take them to their destination.', base: 60, perUnit: 1.2, pickupInVehicle: true, pickupText: 'Pick up the passenger', dropText: 'Drop off the passenger' },
};

export const MODS = {
  engine: { name: 'Engine tuning', max: 3, price: [8000, 20000, 45000] },
  brakes: { name: 'Brakes', max: 3, price: [4000, 10000, 22000] },
  tires:  { name: 'Tire grip', max: 3, price: [5000, 12000, 26000] },
  nitro:  { name: 'Nitro tank', max: 3, price: [6000, 15000, 35000] },
  kit:    { name: 'Body kit (spoiler, skirts, underglow)', max: 3, price: [7000, 16000, 34000] },
};
// pad = start zone (drive in with a car). Two racers in the zone start a 5s countdown; E starts a solo run.
export const RACES = {
  tutorial: { name: 'Tutorial Race', pad: [0, -40], cps: [[0, -80], [80, -80], [80, 0], [0, 0]], pay: [0, 0], solo: 0, reward: 50000 },
  city: { name: 'City Race', pad: [-40, 0], cps: [[80, 0], [80, 80], [160, 80], [160, -80], [80, -80], [0, -80], [-80, -80], [-80, 0], [-40, 0]], pay: [100000, 10000], solo: 15000 },
  gp: { name: 'Grand Prix', pad: [0, -120], cps: [[0, -160], [160, -160], [160, 0], [160, 160], [0, 160], [-160, 160], [-160, 0], [-160, -160], [-80, -160], [0, -120]], pay: [150000, 25000], solo: 40000 },
};
export const DAILY = [
  { id: 'jobs', name: 'Complete 3 jobs', goal: 3, reward: 5000 },
  { id: 'races', name: 'Finish a race', goal: 1, reward: 10000 },
  { id: 'wins', name: 'Win a race against another player', goal: 1, reward: 25000 },
];

// Starter homes: every player gets one at a different lot (assigned per room, saved on the player).
export const HOME_SLOTS = BLOCKS.flatMap(bx => [100, 140].flatMap(z => [-22, 22].map(o => ({ x: bx + o, z, face: z === 100 ? -1 : 1, dx: bx + o, dz: z + (z === 100 ? -8 : 8) }))));
export const HOME_MAX = 12;
export const FURN = {
  sofa: { name: 'Sofa', price: 600, s: [3, 0.9, 1.2], c: 0x375a7f }, bed: { name: 'Bed', price: 800, s: [2.2, 0.6, 3.2], c: 0xa33a3a },
  table: { name: 'Dining table', price: 300, s: [2, 0.8, 1.2], c: 0x6b4a2b }, tv: { name: 'Big TV', price: 500, s: [2.2, 1.4, 0.2], c: 0x111418 },
  lamp: { name: 'Floor lamp', price: 100, s: [0.4, 2, 0.4], c: 0xf5d76e }, plant: { name: 'Plant', price: 60, s: [0.7, 1.2, 0.7], c: 0x2f7d3a },
  shelf: { name: 'Bookshelf', price: 250, s: [1.8, 2.2, 0.5], c: 0x8d6e4b }, rug: { name: 'Rug', price: 120, s: [2.8, 0.04, 2], c: 0x8a3b3b },
  fridge: { name: 'Fridge', price: 700, s: [0.9, 2, 0.9], c: 0xdddddd }, desk: { name: 'Desk', price: 280, s: [1.6, 0.8, 0.8], c: 0xb08d57 },
  piano: { name: 'Piano', price: 2500, s: [1.8, 1.2, 0.9], c: 0x151515 }, pool: { name: 'Pool table', price: 3000, s: [2.6, 0.9, 1.5], c: 0x1f7a4d },
  aquarium: { name: 'Aquarium', price: 1800, s: [2, 1, 0.7], c: 0x38bdf8 },
};
// [name, price, health restored]
export const VENUES = {
  cafe: { npc: 'Bea the Barista', items: [['Coffee', 5, 15], ['Burger', 15, 40], ['Cake slice', 10, 25]] },
  grocery: { npc: 'Gus at the Register', items: [['Water', 3, 10], ['Snack pack', 8, 20], ['Meal kit', 30, 70]] },
  hospital: { npc: 'Nurse Nia', items: [['Checkup (full heal)', 100, 100]] },
};
