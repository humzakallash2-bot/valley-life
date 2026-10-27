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
  sedan:  { name: 'Starter Sedan', price: 0,     maxSpeed: 38, accel: 12, brake: 30, turn: 0.55, size: [1.9, 1.4, 4.5], cabin: 0.50, weight: 1300, color: 0x1e88e5 },
  taxi:   { name: 'City Taxi',     price: 7000,  maxSpeed: 36, accel: 12, brake: 30, turn: 0.55, size: [1.9, 1.5, 4.5], cabin: 0.50, weight: 1350, color: 0xfdd835 },
  suv:    { name: 'Trail SUV',     price: 9000,  maxSpeed: 35, accel: 10.5, brake: 28, turn: 0.50, size: [2.1, 1.9, 4.8], cabin: 0.60, weight: 2100, color: 0x43a047 },
  pickup: { name: 'Ranch Pickup',  price: 12000, maxSpeed: 36, accel: 11, brake: 28, turn: 0.50, size: [2.1, 1.9, 5.3], cabin: 0.40, weight: 2300, color: 0xe53935 },
  van:    { name: 'Cargo Van',     price: 15000, maxSpeed: 32, accel: 9,  brake: 26, turn: 0.45, size: [2.1, 2.4, 5.3], cabin: 0.85, weight: 2600, color: 0xffffff },
  sports: { name: 'Apex GT',       price: 45000, maxSpeed: 62, accel: 22, brake: 38, turn: 0.60, size: [1.95, 1.15, 4.4], cabin: 0.45, weight: 1400, color: 0xfb8c00 },
  luxury: { name: 'Regal Sedan',   price: 60000, maxSpeed: 50, accel: 16, brake: 33, turn: 0.50, size: [2.0, 1.45, 5.0], cabin: 0.52, weight: 2000, color: 0x212121 },
};

const sp = (id, label, x, z, w, d, h, color) => ({ id, label, x, z, w, d, h, color, ix: x, iz: z + d / 2 + 2.5 });
export const SPECIAL = [
  sp('dealer', 'Vehicle Dealership', -40, -40, 34, 22, 9, 0x2f80ed),
  sp('jobs', 'Job Center', 40, -40, 26, 20, 10, 0xf2994a),
  sp('police', 'Police Station', -120, -40, 30, 24, 10, 0x3a4a8c),
  sp('hospital', 'Hospital', 120, -40, 34, 28, 16, 0xe8eef5),
  sp('grocery', 'Grocery Store', -120, 40, 32, 22, 8, 0x6fcf97),
  sp('gas', 'Gas Station', -40, 40, 16, 12, 5, 0xeb5757),
  sp('mechanic', 'Mechanic Shop', 40, 40, 24, 18, 7, 0x828282),
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
