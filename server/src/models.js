import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 60
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true
        },

        passwordHash: {
            type: String,
            required: true
        },

        avatar: String,

        bio: {
            type: String,
            default: ''
        },

        lastSeen: Date,

        pushSubscriptions: [
            Schema.Types.Mixed
        ],

        resetTokenHash: String,

        resetTokenExpiresAt: Date,

        encryptionPublicKey: Schema.Types.Mixed
    },
    {
        timestamps: true
    }
);

const chatSchema = new Schema(
    {
        type: {
            type: String,
            enum: ['direct', 'group'],
            required: true
        },

        members: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ],

        title: String,

        avatar: String,

        adminIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ],

        lastMessage: {
            type: Schema.Types.ObjectId,
            ref: 'Message'
        },

        keyEnvelopes: [
            {
                user: {
                    type: Schema.Types.ObjectId,
                    ref: 'User'
                },

                encryptedKey: String,

                iv: String,

                senderPublicKey: Schema.Types.Mixed
            }
        ]
    },
    {
        timestamps: true
    }
);

const messageSchema = new Schema(
    {
        chat: {
            type: Schema.Types.ObjectId,
            ref: 'Chat',
            required: true,
            index: true
        },

        sender: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },

        ciphertext: {
            type: String,
            required: true
        },

        iv: {
            type: String,
            required: true
        },

        kind: {
            type: String,
            enum: [
                'text',
                'image',
                'video',
                'file',
                'voice'
            ],
            default: 'text'
        },

        attachment: {
            url: String,
            name: String,
            mime: String,
            size: Number
        },

        status: {
            type: String,
            enum: [
                'sent',
                'delivered',
                'read'
            ],
            default: 'sent'
        },

        readBy: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ]
    },
    {
        timestamps: true
    }
);

export const User = model('User', userSchema);
export const Chat = model('Chat', chatSchema);
export const Message = model('Message', messageSchema);
