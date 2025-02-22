import * as openpgp from "openpgp";
import geolib from 'geolib';
import { IndexedDatabase } from 'indexdb-prisma';
import { schemaMockup } from './schema';

export function getRandomConfession() {
  const confessions = [
    "I secretly eat an entire pizza... by myself... at 2 AM.",
    "I still don't know how to fold a fitted sheet.",
    "I have a collection of empty jars that I tell myself I’ll use someday.",
    "I’ve rewatched the same TV show so many times, I can quote every episode.",
    "I once tried to pet a cactus because I thought it was a cool plant. It wasn't.",
    "I accidentally sent a text meant for my friend to my boss. Oops.",
    "I always skip the last few pages of books because I’m scared of spoilers... even though I’ve already read them.",
    "I’ve fallen asleep in class... during a presentation... about sleep.",
    "I may or may not have had a heated argument with Siri.",
    "Sometimes I wear mismatched socks on purpose just to keep life interesting.",
    "I convinced my cat to watch a whole movie with me, and yes, they loved it.",
    "I sometimes pretend I didn’t see the email to avoid responding.",
    "I own way too many pens, but I can never find one when I need it.",
    "I’ve definitely Googled ‘how to be a better adult’ more than once.",
    "I once tried to cook a five-star meal... it ended up as a five-minute disaster."
  ];

  const randomIndex = Math.floor(Math.random() * confessions.length);
  return confessions[randomIndex];
}
export function chunkMessage(message) {
  const MAX_CHUNK_SIZE = 400;
  const chunks = [];
  for (let i = 0; i < message.length; i += MAX_CHUNK_SIZE) {
    chunks.push(message.slice(i, i + MAX_CHUNK_SIZE));
  }
  return chunks;
}
export function processChunk(sender, data, messageBuffer, node) {
  if (!messageBuffer[sender]) messageBuffer[sender] = [];

  try {
    const chunk = JSON.parse(data);
    if (typeof chunk.index !== "number" || !chunk.total || !chunk.content) {
      console.log(`Invalid chunk from ${sender}, disconnecting...`);
      node.hangUp(sender);
      return;
    }

    messageBuffer[sender][chunk.index] = chunk.content;

    if (messageBuffer[sender].length === chunk.total) {
      const fullMessage = messageBuffer[sender].join('');
      delete messageBuffer[sender];
      return fullMessage;
    }
  } catch (e) {
    console.log(`Invalid chunk format from ${sender}, disconnecting...`);
    node.hangUp(sender);
  }
}

export async function importPost({ signature, publicKey, data, node, from, raw }) {
  const db = await IndexedDatabase('herds', { schema: schemaMockup });
  const key = await openpgp.readKey({
    armoredKey: publicKey
  });
  let exists = await db.posts.getOne('id', key.getFingerprint());
  if (exists) return;
  const signedMessage = await openpgp.createMessage({
    text: data
  });
  const signatureObject = await openpgp.readSignature({
    armoredSignature: signature
  });
  const verificationResult = await openpgp.verify({
    message: signedMessage,
    signature: signatureObject,
    verificationKeys: key
  });
  const { verified } = verificationResult.signatures[0];

  try {
    await verified;
    const json = JSON.parse(data);
    await db.posts.createOne({
      id: key.getFingerprint(),
      text: json.text,
      importedAt: new Date(),
      latitude: json.latitude.toString(),
      longitude: json.longitude.toString(),
      publicKey: publicKey,
      createdAt: new Date(json.date),
      signature: signature,
      raw
    },)

  } catch (e) {
    console.error('Signature verification failed:', e);
    await node.hangUp(from);
  }
  return null;
}

export function skewLocation(lat, lon, minDistanceKm = 2, maxDistanceKm = 2.7) {
  const earthRadiusKm = 6371;

  const minDistRad = minDistanceKm / earthRadiusKm;
  const maxDistRad = maxDistanceKm / earthRadiusKm;

  const randomDist = minDistRad + Math.random() * (maxDistRad - minDistRad);
  const randomAngle = Math.random() * 2 * Math.PI;

  const newLat = lat + (randomDist * Math.cos(randomAngle)) * (180 / Math.PI);

  const newLon = lon + (randomDist * Math.sin(randomAngle)) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);

  return { latitude: newLat, longitude: newLon };
}
export function rankPosts(posts, userLat, userLon) {
  const alpha = 0.3;
  const beta = 0.3;
  const now = Date.now();

  return posts.map(post => {
    const distance = geolib.getDistance({
      latitude: userLat,
      longitude: userLon
    },
      {
        latitude: post.latitude,
        longitude: post.longitude
      });
    const hoursAgo = (now - new Date(post.date).getTime()) / 3600000;

    const score = Math.exp(-alpha * distance) * Math.exp(-beta * hoursAgo);

    return { ...post, score };
  }).sort((a, b) => b.score - a.score);
}

export async function newPost({ latitude, longitude, text, parent, node, db }) {
  const postDate = new Date();

  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits: 4096,
    userIDs: [{ name: 'Anon', email: 'anon@example.com' }],
    passphrase: "post"
  });
  const key = await openpgp.readKey({ armoredKey: privateKey });


  const textToSign = JSON.stringify({
    id: key.getFingerprint(),
    text,
    latitude,
    date: postDate.toISOString(),
    longitude
  });
  const message = await openpgp.createMessage({ text: textToSign });

  const privateKeyObj = await openpgp.readPrivateKey({ armoredKey: privateKey });
  const decryptedPrivateKey = await openpgp.decryptKey({ privateKey: privateKeyObj, passphrase: 'post' });

  const signature = await openpgp.sign({
    message: message,
    signingKeys: decryptedPrivateKey,
    detached: true
  })
  var packet = JSON.stringify({
    signature: signature,
    publicKey,
    id: key.getFingerprint(),
    data: textToSign
  });

  await db.posts.createOne({
    id: key.getFingerprint(),
    text: text,
    importedAt: new Date(),
    latitude: latitude,
    longitude: longitude,
    publicKey: publicKey,
    privateKey: privateKey,
    createdAt: new Date(),
    signature: signature,
    raw: packet
  })
  return packet;
}