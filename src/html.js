import geolib from 'geolib';
import prettydate from 'pretty-date';
import { skewLocation, getRandomConfession, newPost, chunkMessage, importPost, rankPosts } from './utils';
import { IndexedDatabase } from 'indexdb-prisma';
import { schemaMockup } from './schema';
import { processChunk } from './utils';
import { GossipSub } from '@chainsafe/libp2p-gossipsub';
export const getUserLocation = (position) => {
    const { latitude, longitude } = skewLocation(position.coords.latitude, position.coords.longitude);
    sessionStorage.setItem("lat", latitude);
    sessionStorage.setItem("lon", longitude);

    document.querySelector("#submit").disabled = false;
};
const showMap = function(latitude, longitude) {
    const popup = new Popup({
        id: "map",
        title: "",
        content:
            "",
        sideMargin: "2.9vw",
        titleColor: "#fff",
        textColor: "#fff",
        backgroundColor: "#222",
        closeColor: "#fff",
        fontSizeMultiplier: 1.2,
        linkColor: "#888",
        hideCallback: () => {
            window.map.remove();
            document.querySelector(".popup").remove()
        },
    });
    popup.show()
    const mapContainer = document.createElement('div');
    mapContainer.id = 'map';
    mapContainer.style.width = '100%';
    mapContainer.style.height = '400px';
    document.querySelector(".popup-body").appendChild(mapContainer);

    window.map = L.map('map').setView([latitude, longitude], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    L.marker([latitude, longitude]).addTo(map)
        .bindPopup('Approx. Location')
        .openPopup();
}
const waitForLatLon = () => {
    return new Promise((resolve) => {
        const checkLatLon = () => {
            const lat = sessionStorage.getItem('lat');
            const lon = sessionStorage.getItem('lon');
            if (lat && lon) {
                resolve({ lat, lon });
            } else {
                setTimeout(checkLatLon, 100); 
            }
        };
        checkLatLon();
    });
};

export const initializeApp = async (node, db) => {
    const postsElement = document.querySelector("#posts");
    if (postsElement) {
        postsElement.innerHTML = "Loading! OpenHerd needs to fetch your location first as it sorts posts by location and time. Don't worry! Your location stays client side.";
    }
    navigator.geolocation.getCurrentPosition(getUserLocation);
    await waitForLatLon();
    const textElement = document.querySelector("#text");
    if (textElement instanceof HTMLTextAreaElement) {
        textElement.placeholder = getRandomConfession();
    }

    const messageBuffer = {};


    setupNodeListeners(node, messageBuffer, db);
    await loadInitialPosts(db);

    const postButton = document.querySelector("#submit");
    setupPostButtonListener(postButton, node, db);
};

const setupNodeListeners = async (node, messageBuffer) => {
    const db = await IndexedDatabase('herds', { schema: schemaMockup });

    node.addEventListener('peer:disconnect', async (event) => {
        const peerId = event.detail;
        console.log(`Peer disconnected: ${peerId.toString()}`);
        try {
            await node.dial(peerId);
            console.log(`Redialed peer: ${peerId.toString()}`);
        } catch (err) {
            console.error(`Failed to redial peer: ${peerId.toString()}`, err);
        }
    });

    node.services.pubsub.addEventListener('message', async (message) => {
        const { topic, from, data } = message.detail;
        if (!["posts", "catchup", "backlog"].includes(topic)) return;
        const decodedData = new TextDecoder().decode(data);
        const processed = processChunk(from, decodedData, messageBuffer, node);
        if (!processed) return;

        try {
            const parsedData = JSON.parse(processed)
            if (topic === "backlog") {
                parsedData.forEach(post => importPost({ ...JSON.parse(post), node, from, raw: post, db }));
            } else if (topic === "posts>") {
                importPost({ ...parsedData.data, node, from, raw: parsedData, db });
            } else if (topic === "catchup"){
                const db = await IndexedDatabase('herds', { schema: schemaMockup });
                var posts = await db.posts.getMany();
                posts.filter(post=>post.raw).map(post=>{
                    return {
                        "signature": post.signature,
                        "publicKey": post.publicKey,
                        "id": post.id,
                        "data": post.raw
                      }
                      
                })
                const chunks = chunkMessage(JSON.stringify(posts));
                await Promise.all(chunks.map(async (chunk, index) => {
                    const packet = { index, total: chunks.length, content: chunk };
                    const readyToSend = new TextEncoder().encode(JSON.stringify(packet));
                    await node.services.pubsub.publish("backlog", readyToSend);
                }));
            }
        } catch (e) {
            console.error(e);
        }
    });
    setInterval(function () {
        catchUp(node)
    }, 5000)
    catchUp(node)
};

const catchUp = async (node) => {
    let peers = node.services.pubsub
    if (!peers) return;
    const chunks = chunkMessage(JSON.stringify({}));
    await Promise.all(chunks.map(async (chunk, index) => {
        const packet = { index, total: chunks.length, content: chunk };
        const readyToSend = new TextEncoder().encode(JSON.stringify(packet));
        const a = await node.services.pubsub.publish("catchup", readyToSend);
    }));
};

const loadInitialPosts = async (db) => {
    if (location.pathname === "/") {
        var posts = await db.posts.getMany();
        const postsElement = document.querySelector("#posts");
        if (!posts.length) {
            if (postsElement) {
                postsElement.innerHTML = "No posts yet! Openherd still needs to load them to your device. This can take up to a few seconds.";
            }
        } else {
            if (postsElement) {
                postsElement.innerHTML = "";
                posts = rankPosts(posts, sessionStorage.getItem("lat"), sessionStorage.getItem("lon")).toReversed()
                posts.forEach(post => {
                    const distance = geolib.getDistance(
                        { latitude: post.latitude, longitude: post.longitude },
                        { latitude: sessionStorage.getItem("lat"), longitude: sessionStorage.getItem("lon") }
                    );
                    post.km = geolib.convertDistance(distance, "km").toFixed(2);
                    post.mi = geolib.convertDistance(distance, "mi").toFixed(2);
                    postsElement.innerHTML += `
                        <blockquote>
                            <p>${post.text}</p>
                        </blockquote>
                        <p><abbr title="Click to show approx. location on a map.">${post.km}km (${post.mi}mi) away approx</abbr>. &bull; <time datetime="${post.createdAt.toISOString()}">${post.createdAt.toLocaleString('en-US', { timeStyle: "short", dateStyle: "long" })} (${prettydate.format(new Date(post.createdAt || ""))})</time></p>
                        <hr>`;
                });
        
                postsElement.querySelectorAll('abbr').forEach((abbr, index) => {
                abbr.addEventListener('click', () => {
                        const post = posts[index];
                        showMap(post.latitude, post.longitude);
                    });
                });
            }
        }
    }
};
setInterval(async function () {
    const db = await IndexedDatabase('herds', { schema: schemaMockup });

    loadInitialPosts(db)
}, 5000)
const setupPostButtonListener = (postButton, node, db) => {
    if (postButton) {
        postButton.addEventListener('click', async () => {
            document.querySelector("#submit").disabled = false;
            document.querySelector("#submit").innerHTML = "Posting...";
            const lat = sessionStorage.getItem("lat");
            const lon = sessionStorage.getItem("lon");
            const textElement = document.querySelector("#text");
            if (lat && lon && textElement instanceof HTMLTextAreaElement) {
                const text = textElement.value;
                if (!text) return alert("No text!");
                try {
                    const packet = await newPost({ latitude: lat, longitude: lon, text, parent: null, node, db });
                    const chunks = chunkMessage(packet);
                    await Promise.all(chunks.map(async (chunk, index) => {
                        await node.services.pubsub.publish("posts", new TextEncoder().encode(JSON.stringify({
                            index,
                            total: chunks.length,
                            content: chunk
                        })));
                    }));
                    console.log('New post created:', packet);
                    document.querySelector("#submit").disabled = true;
                    document.querySelector("#submit").innerHTML = "Post!";
                } catch (err) {
                    console.error('Failed to create new post:', err);
                }
            } else {
                console.error('Missing location or text input');
            }
        });
    }
};