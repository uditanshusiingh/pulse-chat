import { api } from './api';

const b64 = bytes =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)));

const unb64 = value =>
    Uint8Array.from(atob(value), char => char.charCodeAt(0));

const privateKeyName = 'pulse-identity-private';
const publicKeyName = 'pulse-identity-public';

async function identity() {
    const savedPrivate = localStorage.getItem(privateKeyName);
    const savedPublic = localStorage.getItem(publicKeyName);

    if (savedPrivate && savedPublic) {
        return {
            privateKey: await crypto.subtle.importKey(
                'jwk',
                JSON.parse(savedPrivate),
                {
                    name: 'ECDH',
                    namedCurve: 'P-256'
                },
                false,
                ['deriveBits']
            ),
            publicKey: JSON.parse(savedPublic)
        };
    }

    const pair = await crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: 'P-256'
        },
        true,
        ['deriveBits']
    );

    const privateKey = await crypto.subtle.exportKey(
        'jwk',
        pair.privateKey
    );

    const publicKey = await crypto.subtle.exportKey(
        'jwk',
        pair.publicKey
    );

    localStorage.setItem(
        privateKeyName,
        JSON.stringify(privateKey)
    );

    localStorage.setItem(
        publicKeyName,
        JSON.stringify(publicKey)
    );

    return {
        privateKey: pair.privateKey,
        publicKey
    };
}

export async function registerEncryptionKey() {
    const userIdentity = await identity();

    await api.put('/api/me/encryption-key', {
        publicKey: userIdentity.publicKey
    });
}

async function wrappingKey(privateKey, publicKeyJwk) {
    const otherPublicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        {
            name: 'ECDH',
            namedCurve: 'P-256'
        },
        false,
        []
    );

    const sharedSecret = await crypto.subtle.deriveBits(
        {
            name: 'ECDH',
            public: otherPublicKey
        },
        privateKey,
        256
    );

    return crypto.subtle.importKey(
        'raw',
        sharedSecret,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
    );
}

function saveChatKey(chatId, rawKey) {
    localStorage.setItem(
        `pulse-key:${chatId}`,
        b64(rawKey)
    );
}

function localChatKey(chatId) {
    const stored = localStorage.getItem(`pulse-key:${chatId}`);

    return stored ? unb64(stored) : null;
}

async function aesKey(rawKey) {
    return crypto.subtle.importKey(
        'raw',
        rawKey,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
    );
}

export async function createChatKeyEnvelope(recipientId) {
    const userIdentity = await identity();

    const response = await api.get(
        `/api/users/${recipientId}/encryption-key`
    );

    const recipientPublicKey = response.data.publicKey;

    if (!recipientPublicKey) {
        throw new Error(
            'The other user has not opened the updated app yet.'
        );
    }

    const rawChatKey = crypto.getRandomValues(
        new Uint8Array(32)
    );

    const iv = crypto.getRandomValues(
        new Uint8Array(12)
    );

    const key = await wrappingKey(
        userIdentity.privateKey,
        recipientPublicKey
    );

    const encryptedKey = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv
        },
        key,
        rawChatKey
    );

    return {
        rawChatKey,
        envelope: {
            user: recipientId,
            encryptedKey: b64(encryptedKey),
            iv: b64(iv),
            senderPublicKey: userIdentity.publicKey
        }
    };
}

async function chatKey(chat) {
    const existing = localChatKey(chat._id);

    if (existing) {
        return aesKey(existing);
    }

    const me = JSON.parse(
        localStorage.getItem('pulse-user')
    );

    const envelope = chat.keyEnvelopes?.find(
        item =>
            String(item.user?._id || item.user) === me.id
    );

    if (!envelope) {
        throw new Error(
            'Encryption key is unavailable for this chat.'
        );
    }

    const userIdentity = await identity();

    const key = await wrappingKey(
        userIdentity.privateKey,
        envelope.senderPublicKey
    );

    const rawChatKey = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: unb64(envelope.iv)
        },
        key,
        unb64(envelope.encryptedKey)
    );

    saveChatKey(chat._id, rawChatKey);

    return aesKey(rawChatKey);
}

export async function saveNewChatKey(chatId, rawKey) {
    saveChatKey(chatId, rawKey);
}

export async function encrypt(chat, text) {
    const iv = crypto.getRandomValues(
        new Uint8Array(12)
    );

    const encrypted = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv
        },
        await chatKey(chat),
        new TextEncoder().encode(text)
    );

    return {
        ciphertext: b64(encrypted),
        iv: b64(iv)
    };
}

export async function decrypt(chat, payload) {
    try {
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: unb64(payload.iv)
            },
            await chatKey(chat),
            unb64(payload.ciphertext)
        );

        return new TextDecoder().decode(decrypted);
    } catch {
        return '🔒 Encrypted message — key unavailable on this device';
    }
}
