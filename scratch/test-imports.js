import 'dotenv/config';
import * as firebaseAuthCtrl from '../controllers/firebaseAuth.controller.js';
import * as networkCtrl from '../controllers/network.controller.js';

console.log('Testing service imports after level unlock changes...');
console.log('firebaseAuthCtrl functions:', Object.keys(firebaseAuthCtrl));
console.log('networkCtrl functions:', Object.keys(networkCtrl));

console.log('✅ Imports verified successfully!');
