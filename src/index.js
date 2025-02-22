import { setupLibp2pNode } from './libp2p';
import { initializeApp } from './html';
import { IndexedDatabase } from 'indexdb-prisma';
import { schemaMockup } from './schema';



const App = async () => {
    const db = await IndexedDatabase('herds', { schema: schemaMockup });
  const node = await setupLibp2pNode();
  await initializeApp(node, db);
};


if ('serviceWorker' in navigator && !location.host.includes("localhost")) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }, err => {
          console.log('ServiceWorker registration failed: ', err);
        });
    });
  }
    
App().catch((err) => {
    console.error(err); // eslint-disable-line no-console
});