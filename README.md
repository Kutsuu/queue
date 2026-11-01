# Queue

Queue on kooliürituste tehnilise tiimi ühine tööruum. Kasutajaliides on eesti keeles. Tootmiskeskkond töötab GitHub Pagesis, sisselogimine ja sündmuste andmed Firebase’is.

## Ligipääsu mudel

- Sisselogimine toimub e-posti ja parooliga. Google’i, Microsofti ja avaliku registreerimise nuppe pole.
- Projekti omanik lisab iga kasutaja Firebase Authenticationisse ning loob Firestore’is käsitsi liikme dokumendi `members/{UID}`.
- Queue avab Firestore’i andmed ainult siis, kui kasutajal on aktiivne `members/{UID}` kirje.
- Kõigil lubatud liikmetel on samad Queue õigused. Rakenduses pole administraatori rolli ega sündmuse kustutamise nuppu.
- Kasutaja nimi peab koosnema täpselt kahest sõnast: eesnimi ja perekonnanimi.
- Märkmete osakonnad kuvatakse `KÕIK`, `HELI`, `VALGUS`, `VIDEO` (andmebaasis salvestatakse `KÕIK` tehnilise väärtusena `ALL`). Kõik liikmed näevad kõiki märkmeid ja võivad neid filtriga sortida.

## Firebase’i seadistamine

Queue ei kasuta Cloud Functionse ega serveri saladusi. Firestore’i turvareeglid on andmetele ligipääsu peamine kontroll.

1. **Authentication:** Firebase Console → Authentication → Sign-in method → luba **Email/Password**. Lisa Authorized domains loendisse `localhost`, `127.0.0.1` ja GitHub Pagesi domeen, näiteks `my-school.github.io`.

2. **Firestorе:** olemasolev Euroopa Firestore’i andmebaas sobib. Queue kasutab sündmuste, esinemiste, märkmete ja vestluse jaoks Firestore’i.

3. **Realtime Database kella sünkroonimiseks:** loo Firebase Console’is Realtime Database Euroopa regioonis. Kopeeri andmebaasi URL kujul `https://PROJECT-default-rtdb.europe-west1.firebasedatabase.app`. Queue kasutab sealt ainult serverikella nihke väärtust; sündmuste andmed jäävad Firestore’i. Realtime Database’i turvareeglid keelavad rakendusel seal andmeid lugeda või muuta.

4. **App Check:** registreeri Queue Web app reCAPTCHA Enterprise’i võtmega. Kohalikus arenduses kasuta ainult Firebase’i App Check debug token’it. Ära lisa debug token’it GitHub Pagesi seadetesse.

   Kohalikuks App Checki debug'iks lisa ainult faili .env.local rida VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true, taaskäivita Queue ning lisa brauseri konsoolis väljastatud debug token Firebase Console'i Queue Web appi App Check seadetes. Ära lisa debug token'it GitHub Pagesi seadistustesse.

5. **Lokaalne seadistus:** kopeeri näidisfail ja lisa Firebase Web Appi väärtused:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Täida `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_DATABASE_URL` ja `VITE_FIREBASE_APP_CHECK_SITE_KEY`. `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` käib ainult kohalikku `.env.local` faili.

6. **CLI ja reeglid:** projekti juurkaustas käivita PowerShellis:

   ```powershell
   firebase.cmd login
   firebase.cmd use queue-8d556
   firebase.cmd deploy --only firestore:rules,firestore:indexes,database --project queue-8d556
   ```

7. **Lisa kasutaja:**
   - Firebase Console → Authentication → Users → Add user. Kasuta kasutaja e-posti ja ajutist juhuslikku parooli; ära jaga seda parooli.
   - Kopeeri kasutaja UID.
   - Firestore → `members` collection → loo dokumendi ID-ks UID.
   - Lisa väljad:

     ```text
     email      string   kasutaja e-posti aadress väiketähtedega
     fullName   string   Eesnimi Perekonnanimi
     enabled    boolean  true
     ```

   - Kasutaja avab Queue sisselogimise ja valib **Esimene kord või unustasid parooli?**. Firebase saadab e-posti kaudu lingi parooli seadistamiseks. Sama toiming sobib hiljem parooli taastamiseks.

   Ligipääsu sulgemiseks määra `members/{UID}.enabled` väärtuseks `false` või eemalda liikme dokument. Kasutaja saab Auth-konto eemaldada Firebase Authenticationi kaudu.

8. **GitHub Pages:** loo repository Actions secrets, mille nimed algavad `VITE_FIREBASE_` ja mille väärtused vastavad `.env.local` muutujatele. Lisa ka `VITE_FIREBASE_DATABASE_URL`, et Host saaks seadmete kellad Firebase’i serveri järgi korrigeerida. Ilma selle väärtuseta töötab rakendus kohaliku süsteemikellaga ja Host näitab sünkroonimise hoiatust. GitHub Settings → Pages peab kasutama GitHub Actionsit.

9. **Sündmuse kustutamine:** sündmuse kustutamine toimub ainult Firebase Console’is. Queue ei paku sündmuse eemaldamist.

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

Firebase’i veebikonfiguratsioon ja reCAPTCHA site key on brauserirakenduse avalikud väärtused. Andmetele ligipääsu kaitsevad Firestore’i Rules ja liikme UID nimekiri. Serveri saladusi ega teenusekonto JSON-faile ei lisata veebirakendusse.

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

- Ava Firebase Console'is App Check ja lülita Firestore'i ning Realtime Database'i enforcement sisse pärast seda, kui production-domeen töötab.
- Lisa production reCAPTCHA Enterprise site key GitHub Actions secrets'i nimega `VITE_FIREBASE_APP_CHECK_SITE_KEY`. Debug token jääb ainult lokaalsesse `.env.local` faili.
- Kontrolli, et `members/{UID}` dokumentides oleks ainult lubatud inimesed ja nende nimi oleks kujul `Eesnimi Perekonnanimi`.
- Asenda `public/privacy.html` kõik nurksulgudes väljad (vastutav töötleja, kontakt, õiguslik alus, säilitustähtaeg ja võimalikud rahvusvahelised edastused); kinnita tekst kooli andmekaitse eest vastutava inimesega. GitHub Actions blokeerib avaldamise, kuni väljad on täidetud.
- Kontrolli GitHub Pages'i Actions deploy'i ja Firebase Rules'i pärast muudatusi. Queue kasutab `npm run deploy` asemel GitHub Actions workflow'd.

## Tehnoloogiad

React · Vite · Firebase Authentication · Cloud Firestore · Firebase Realtime Database (serverikella nihe) · Firebase App Check · GitHub Pages
