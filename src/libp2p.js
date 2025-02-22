import { createLibp2p } from 'libp2p';
import { identify } from '@libp2p/identify';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { multiaddr } from '@multiformats/multiaddr';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { webSockets } from '@libp2p/websockets';
import { webTransport } from '@libp2p/webtransport';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import * as filters from '@libp2p/websockets/filters';
import config from "./config.json" with { type: "json" };

export const setupLibp2pNode = async () => {
    const node = await createLibp2p({
        addresses: {
            listen: ['/webrtc'],
        },
        transports: [
            webSockets({ filter: filters.all }),
            webTransport(),
            webRTC(),
            circuitRelayTransport(),
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux({ enableKeepAlive: true, maxInboundStreams: 100, maxOutboundStreams: 100 })],
        connectionGater: { denyDialMultiaddr: async () => false },
        services: {
            pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
            identify: identify(),
        },
    });
    function discover() {
        config.bootstrappingServers.map(async server => {
            try {
                const listeners = await (await fetch(`${server}/api/listeners`)).json()
                listeners.filter(l => l.includes("wss")).forEach(async l => {
                    try { await node.dial(multiaddr(l)); } catch (e) { }
                })
                const peers = await (await fetch(`${server}/api/discovery`)).json()
                peers.filter(l => l.includes("wss")).forEach(async p => {
                    try { await node.dial(multiaddr(p)) } catch (e) { }
                })
            } catch (e) {

            }
        })
    }
    discover()
    setInterval(discover, 1000 * 30)
    node.services.pubsub.subscribe('posts');
    node.services.pubsub.subscribe('catchup');
    node.services.pubsub.subscribe('backlog');
    setInterval(async function () {
        try {
            document.querySelector("#peers").innerText = `${(await node.peerStore.all()).length} peers connected`
        } catch (e) { }
    }, 1000)
    return node;
};