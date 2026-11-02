# Queue

Queue on kooliürituste tehnilise tiimi ühine tööruum. Kasutajaliides on eesti keeles. Tootmiskeskkond töötab GitHub Pagesis, sisselogimine ja sündmuste andmed Firebase’is.

## Ligipääsu mudel

- Sisselogimine toimub e-posti ja parooliga. Google’i, Microsofti ja avaliku registreerimise nuppe pole.
- Projekti omanik lisab kasutajad Firebase Authenticationisse. Esimesel sisselogimisel küsib Queue nime ning loob kasutaja enda `members/{UID}` dokumendi automaatselt.
- Queue avab Firestore’i andmed ainult siis, kui kasutajal on aktiivne `members/{UID}` kirje.
- Avalik registreerimine peab Firebase Authenticationis olema välja lülitatud. Kui see on sisse lülitatud, saab igaüks konto luua ja Queue liikmeks registreeruda.
- Kõigil lubatud liikmetel on samad Queue õigused. Rakenduses pole administraatori rolli ega sündmuse kustutamise nuppu.
- Kasutaja nimi peab koosnema täpselt kahest sõnast: eesnimi ja perekonnanimi.
- Märkmete osakonnad kuvatakse `KÕIK`, `HELI`, `VALGUS`, `VIDEO` (andmebaasis salvestatakse `KÕIK` tehnilise väärtusena `ALL`). Kõik liikmed näevad kõiki märkmeid ja võivad neid filtriga sortida.

## Firebase’i seadistamine

Queue ei kasuta Cloud Functionse ega serveri saladusi. Firestore’i turvareeglid on andmetele ligipääsu peamine kontroll.

1. **Authentication:** Firebase Console → Authentication → Sign-in method → jäta aktiivseks ainult **Email/Password**. Firebase Authenticationi seadetest lülita **Enable create (sign-up)** välja enne Firestore Rules’i kasutamist; keela ka anonüümne ja muud sisselogimise pakkujad, kui need on aktiveeritud. Hoia **Email enumeration protection** sees. Lisa Authorized domains loendisse `localhost`, `127.0.0.1` ja GitHub Pagesi domeen, näiteks `my-school.github.io`.

2. **Firestorе:** olemasolev Euroopa Firestore’i andmebaas sobib. Queue kasutab sündmuste, esinemiste, märkmete ja vestluse jaoks Firestore’i.

3. **Realtime Database kella sünkroonimiseks:** loo Firebase Console’is Realtime Database Euroopa regioonis. Kopeeri andmebaasi URL kujul `https://PROJECT-default-rtdb.europe-west1.firebasedatabase.app`. Queue kasutab sealt ainult serverikella nihke väärtust; sündmuste andmed jäävad Firestore’i. Realtime Database’i turvareeglid keelavad rakendusel seal andmeid lugeda või muuta.

4. **Lokaalne seadistus:** kopeeri näidisfail ja lisa Firebase Web Appi väärtused:

   ```powershell
   Copy-Item .env.example .env.local
   ```

Firebase API key on avalik projektiseade koodis. Lisa .env.local faili Firebase Web Appi seaded: VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID ja VITE_FIREBASE_DATABASE_URL.

5. **CLI ja reeglid:** projekti juurkaustas käivita PowerShellis:

   ```powershell
   firebase.cmd login
   firebase.cmd use queue-8d556
   firebase.cmd deploy --only firestore:rules,firestore:indexes,database --project queue-8d556
   ```

6. **Lisa kasutaja:**
   - Firebase Console → Authentication → Users → Add user. Kasuta kasutaja e-posti ja ajutist juhuslikku parooli; ära jaga seda parooli.
   - Palu kasutajal Queue sisselogimislehel valida **Esimene kord või unustasid parooli?**. Firebase saadab lingi parooli seadistamiseks. Sama toiming sobib hiljem parooli taastamiseks.
   - Esimesel sisselogimisel sisestab kasutaja nime kujul `Eesnimi Perekonnanimi`. Queue loob tema UID alla Firestore’i `members/{UID}` dokumendi väljadega `email`, `fullName` ja `enabled: true`. Firestore’i dokumenti pole vaja käsitsi luua.

   Ligipääsu sulgemiseks määra olemasolevas `members/{UID}` dokumendis `enabled` väärtuseks `false` ja peata konto Firebase Authenticationis. Kui eemaldad liikme dokumendi, loo enne seda Firebase Console’is `memberRevocations/{UID}` dokument, näiteks väljaga `revokedAt` (timestamp). Selle UID-ga kasutaja ei saa enam profiili ise uuesti luua. Rakendus ei luba klientidel seda loendit lugeda ega muuta.

7. **GitHub Pages:** loo Actions secrets väärtustele VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID ja VITE_FIREBASE_DATABASE_URL. API key on koodis. GitHub Settings → Pages peab kasutama GitHub Actionsit.

8. **Sündmuse kustutamine:** omanik kustutab sündmusi Firebase Console'is. Queue ei paku sündmuse eemaldamist.

## Kohalik käivitamine

Vaja on Node.js-i ja Python 3-e. Projekti kaustas kasuta üht neist:

```powershell
npm ci
npm run dev
```

või käivita `python run_local.py` või Windowsis `start_queue.bat`. Ava Vite’i näidatud aadress, tavaliselt `http://127.0.0.1:5173/`.

## Režiimid

- **Production** jälgib aktiivset esinemist, ajatelge, viit järgnevat etteastet, märkmeid ja üldvestlust.
- **Host** lisab valitud cue juurde liikumise, esituse ja pausi käsud. Käsk kinnitatakse Firestore’i tehinguna; samaaegsetest käskudest jääb kehtima viimasena salvestunu.
- **Edit** muudab järjekorda. Algus- ja lõpuajad arvutatakse kestustest ning neid ei saa otse muuta. Esinemise kestus ja värv on muudetavad. Esinemiste vahele saab lisada või sealt eemaldada üheminutilise lava vahetuse.

Ajatelg algab `00:00:00` juurest. Paus peatab ajatelje, edasi- ja tagasiliikumine viib sihtcue planeeritud algusaega. Host’i kõrvalekalle võrdleb praegust serveriaega sündmuse planeeritud algusaja ja ajatelje positsiooniga; see muutub ka pausi ajal.

Firebase web configuration is public. Firestore Rules and the member UID list control access to data. Do not put server secrets or service account files in the web app.

## Kontrollid ja avaldamise eelsed sammud

Käivita tavapärased loogika- ja tootmiskontrollid:

```powershell
npm ci
npm test
npm run build
```

Firestore Rules testid kasutavad ainult kohalikke Auth ja Firestore Emulator'eid. Paigalda JDK 21 või uuem ning käivita:

```powershell
firebase.cmd emulators:exec --project demo-queue-rules --only firestore,auth "npm run test:rules"
```

Enne GitHub Pages'is avaldamist:

- Ava GitHubis Settings → Pages ja vali Build and deployment → Source → GitHub Actions. Vite'i lähtefailide otse Pagesi harust avaldamine jätab rakenduse tühjaks; avaldada tuleb Actionsi loodud `dist`.
- Firebase Console -> Security -> App Check -> APIs: vali Cloud Firestore ja Realtime Database ning lülita enforcement välja. Hoia Firestore Rules ja Realtime Database Rules aktiivsena.
- Veendu, et avalik Firebase Authenticationi registreerimine oleks välja lülitatud. Kontrolli, et Authenticationisse lisataks ainult kutsutud inimesed. Kui liikmeprofiil eemaldatakse ligipääsu lõpetamiseks, lisa ka `memberRevocations/{UID}` dokument.
- Asenda `public/privacy.html` kõik nurksulgudes väljad (vastutav töötleja, kontakt, õiguslik alus, säilitustähtaeg ja võimalikud rahvusvahelised edastused); kinnita tekst kooli andmekaitse eest vastutava inimesega. GitHub Actions blokeerib avaldamise, kuni väljad on täidetud.
- Kontrolli GitHub Pages'i Actions deploy'i ja Firebase Rules'i pärast muudatusi. Queue kasutab `npm run deploy` asemel GitHub Actions workflow'd.

## Tehnoloogiad
