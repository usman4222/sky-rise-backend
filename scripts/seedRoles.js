import dotenv from 'dotenv';
import connectDB from '../config/db.js';

import Role from '../models/auth/role.model.js';
import User from '../models/auth/user.model.js';
import UserRole from '../models/auth/user_role.model.js';

dotenv.config();

const seedRoles = async () => {
    try {
        await connectDB();

        const defaultRoles = [
            {
                name: 'USER',
                description: 'Default normal user role',
                permissions: []
            },
            {
                name: 'ADMIN',
                description: 'Admin dashboard role',
                permissions: []
            },
            {
                name: 'SUPER_ADMIN',
                description: 'Full platform access role',
                permissions: []
            }
        ];

        for (const roleData of defaultRoles) {
            const role = await Role.findOneAndUpdate(
                { name: roleData.name },
                roleData,
                {
                    upsert: true,
                    returnDocument: 'after'
                }
            );

            console.log(`✅ Role ready: ${role.name}`);
        }

        const userRole = await Role.findOne({ name: 'USER' });

        const users = await User.find({});

        for (const user of users) {
            const alreadyAssigned = await UserRole.findOne({
                user: user._id,
                role: userRole._id
            });

            if (!alreadyAssigned) {
                await UserRole.create({
                    user: user._id,
                    role: userRole._id
                });

                console.log(`✅ USER role assigned to: ${user.email}`);
            }
        }

        console.log('🎉 Roles seeded and assigned successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seed roles error:', error);
        process.exit(1);
    }
};

seedRoles();