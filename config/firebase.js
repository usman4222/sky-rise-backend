import admin from 'firebase-admin';

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

console.log('Firebase env exists:', Boolean(rawServiceAccount));

if (!rawServiceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT env variable is missing on live server');
}

let serviceAccount;

try {
    serviceAccount = JSON.parse(rawServiceAccount);

    if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
} catch (error) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON: ' + error.message);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

export default admin;