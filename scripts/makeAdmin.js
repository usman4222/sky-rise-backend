import dotenv from 'dotenv';
import connectDB from '../config/db.js';

import User from '../models/auth/user.model.js';
import Role from '../models/auth/role.model.js';
import UserRole from '../models/auth/user_role.model.js';

dotenv.config();

const makeAdmin = async () => {
    try {
        await connectDB();

        const email = process.argv[2];

        if (!email) {
            console.log('❌ Please provide admin email');
            console.log('Example: npm run make:admin admin@skyrise.com');
            process.exit(1);
        }

        const user = await User.findOne({ email });

        if (!user) {
            console.log(`❌ User not found with email: ${email}`);
            process.exit(1);
        }

        const adminRole = await Role.findOneAndUpdate(
            { name: 'ADMIN' },
            {
                name: 'ADMIN',
                description: 'Admin user with package, deposit and withdrawal management access',
                permissions: []
            },
            {
                upsert: true,
                returnDocument: 'after',
                setDefaultsOnInsert: true
            }
        );

        await UserRole.findOneAndUpdate(
            {
                user: user._id,
                role: adminRole._id
            },
            {
                user: user._id,
                role: adminRole._id
            },
            {
                upsert: true,
                returnDocument: 'after',
                setDefaultsOnInsert: true
            }
        );

        console.log(`✅ ADMIN role assigned to ${email}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Make admin error:', error);
        process.exit(1);
    }
};

makeAdmin();