import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Deposit from '../models/finance/deposit.model.js';
import Wallet from '../models/finance/wallet.model.js';
import WalletHistory from '../models/finance/wallet_history.model.js';
import Notification from '../models/system/notification.model.js';
import crypto from 'crypto';

dotenv.config();

const approveDeposit = async () => {
    try {
        await connectDB();

        const identifier = process.argv[2];

        if (!identifier) {
            console.log('❌ Please provide a Deposit ID, Transaction ID, or Gateway Transaction ID');
            console.log('Usage: node scripts/approveDeposit.js <deposit_id_or_transaction_id>');
            process.exit(1);
        }

        // Try finding by _id, transactionId, gatewayTransactionId, or cryptoAddress
        let deposit = null;
        if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
            deposit = await Deposit.findById(identifier);
        }
        
        if (!deposit) {
            deposit = await Deposit.findOne({
                $or: [
                    { transactionId: identifier },
                    { gatewayTransactionId: identifier },
                    { cryptoAddress: { $regex: new RegExp('^' + identifier + '$', 'i') } }
                ]
            });
        }

        if (!deposit) {
            console.log(`❌ Deposit not found for identifier: ${identifier}`);
            process.exit(1);
        }

        if (deposit.status === 'completed' || deposit.status === 'approved') {
            console.log(`⚠️ Deposit ${deposit.transactionId} is already completed/approved.`);
            process.exit(0);
        }

        const prevStatus = deposit.status;
        const cpTxnId = deposit.gatewayTransactionId || ('MOCK_APPROVE_TX_' + crypto.randomBytes(4).toString('hex').toUpperCase());

        // Update deposit status
        deposit.status = 'completed';
        deposit.gatewayTransactionId = cpTxnId;
        deposit.remarks = `Manually approved via CLI script. Previous status: ${prevStatus}`;
        deposit.processedAt = new Date();
        await deposit.save();

        // Find or create user wallet
        let wallet = await Wallet.findOne({ user: deposit.user });
        if (!wallet) {
            wallet = new Wallet({ user: deposit.user });
        }

        const prevBal = wallet.deposit || 0;
        wallet.deposit = prevBal + deposit.amountUSDT;
        await wallet.save();

        // Create wallet history log
        await WalletHistory.create({
            user: deposit.user,
            walletType: 'deposit',
            type: 'credit',
            amount: deposit.amountUSDT,
            previousBalance: prevBal,
            newBalance: wallet.deposit,
            category: 'deposit',
            description: `USDT Deposit ($${deposit.amountUSDT.toFixed(2)}) manually approved via CLI. Ref: ${cpTxnId}`,
            referenceModel: 'Deposit',
            referenceId: deposit._id
        });

        // Create notification
        await Notification.create({
            user: deposit.user,
            title: 'Deposit Approved! 💰',
            message: `Your USDT deposit of $${deposit.amountUSDT.toFixed(2)} has been manually verified and credited.`,
            category: 'deposit'
        });

        console.log(`✅ Deposit ${deposit.transactionId} successfully approved!`);
        console.log(`   Amount: $${deposit.amountUSDT.toFixed(2)} USDT`);
        console.log(`   User Wallet Credited! (New Balance: $${wallet.deposit.toFixed(2)} USDT)`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Approve deposit error:', error);
        process.exit(1);
    }
};

approveDeposit();
