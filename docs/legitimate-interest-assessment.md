# Queue'i õigustatud huvi hindamine

**Hindamise kuupäev:** 1. november 2026  
**Vastutav töötleja:** Sergei Žuravljov, Queue arendaja ja haldaja  
**Õiguslik alus:** IKÜM artikkel 6 lõige 1 punkt f

See on Queue praeguse kasutuse kohta koostatud hindamine. Kui rakenduse eesmärk, andmed või kasutajate ring muutub, tuleb hinnang üle vaadata.

## 1. Õigustatud huvi

Queue'i eesmärk on aidata kutsutud kooliürituse tehnilisel tiimil koordineerida esinemiste järjekorda, lava ettevalmistamist ja tööalast infovahetust. Täpne ja ajakohane järjekord ning tiimi märkmed ja sõnumid on selle korraldamiseks praktiliselt vajalikud. Huvi on tegelik, konkreetne ja seotud Queue'i praeguse kasutusega.

## 2. Vajalikkus ja töödeldavad andmed

Rakendus töötleb liikme nime ja e-posti aadressi sisselogimiseks, liikmestaatuse kontrollimiseks ning sõnumi autorina kuvamiseks. Tööruumis töödeldakse sündmuse kuupäeva, algusaega, asukohta, esinemiste pealkirju, vajadusel esinejate nimesid, kestust, tehnilisi märkmeid ja tiimi sõnumeid. Seega võivad tööruumi andmed puudutada ka esinejaid, kellel Queue kontot ei ole; nende nimesid lisatakse ainult siis, kui see on lava korraldamiseks vajalik, ning need on nähtavad ainult sisselogitud Queue liikmetele. Realtime Database'ist loetakse ainult Firebase'i serveri ajavahet; tööruumi sisu sinna ei kirjutata.

Firebase Authenticationis puudub avalik registreerumine. Firestore Rules lubavad tööruumi andmeid lugeda ja muuta ainult sisselogitud liikmel, kellel on lubatud `members/{UID}` dokument. Kasutajakontod lisatakse Firebase'i haldaja poolt. Tööruumi andmeid on vaja Queue'i põhifunktsioonideks, mitte reklaamiks, profiilide koostamiseks ega kasutajate hindamiseks.

## 3. Mõju kasutajatele ja tasakaal

Kasutajad on kutsutud tehnilise tiimi liikmed ning võivad mõistlikult eeldada, et nende nimi, e-post ja tööalased sõnumid on nähtavad teistele tiimiliikmetele. Osa kasutajaid võib olla 16–17-aastane; nende privaatsusvajadusi on arvesse võetud eriti ettevaatlikult. Rakendus ei küsi tundlikke andmeid ega vaja neid. Kasutajatel ei ole vaja lisada vestlusse ega märkmetesse tundlikke või tööks mittevajalikke isikuandmeid.

Võimalik mõju on piiratud, sest sisu ei ole avalik, ligipääs on autentitud liikmetel, sõnumite juures kuvatakse autor ja aeg ning andmesubjekt saab esitada töötlemisele vastuväite või andmetega seotud taotluse vastutavale töötlejale. Teave on piiratud ürituse ettevalmistamise ja tiimi töö korraldamisega. Kui Queue'i kasutamine muutub kohustuslikuks või seda hakatakse kasutama muul eesmärgil, tuleb tasakaal uuesti hinnata.

## 4. Kaitsemeetmed ja säilitamine

- Firebase Authentication nõuab sisselogimist; Firestore Rules kontrollivad aktiivset liikmestaatust ja konto e-posti.
- Firestore Rules piiravad ligipääsu tööruumidele ja valideerivad salvestatavate andmete struktuuri.
- Kasutajaid teavitatakse töötlemisest selles andmekaitseteates; andmetega seotud taotlused saab esitada kontaktile `sergeizuravl@gmail.com`.
- Tööruumi sisu säilitatakse seni, kuni seda on vaja sündmuste ettevalmistamiseks ja tehnilise töö korraldamiseks; kui seda enam vaja ei ole, kustutab vastutav töötleja selle Firebase'ist.
- Vestlusse ja märkmetesse ei tohi lisada tundlikke ega eesmärgi jaoks mittevajalikke isikuandmeid.

## 5. Järeldus

Kirjeldatud piiratud töötlemise puhul on tehnilise tiimi töö koordineerimise huvi konkreetne ning vajalik. Kutsutud liikmetele piiratud ligipääs, minimaalne konto- ja tööruumiinfo, läbipaistvus, vastuväite esitamise võimalus ja eesmärgipärane säilitamine vähendavad mõju kasutajatele. Praeguse kasutuse ja nende kaitsemeetmete põhjal järeldab vastutav töötleja, et see õigustatud huvi ei kaalu üles kasutajate õigusi ja vabadusi, sealhulgas 16–17-aastaste kasutajate õigusi.

See järeldus kehtib ainult ülalkirjeldatud kasutusele. Kui ligipääs muutub avalikuks või kohustuslikuks, lisatakse tundlikke andmeid, muutub eesmärk või kasutatakse andmeid muul viisil, tuleb hindamine uuesti läbi viia enne muudatuse kasutuselevõttu.

## Allikad

- [IKÜM artikkel 6 lõige 1 punkt f — Andmekaitse Inspektsioon](https://www.aki.ee/oigustatud-huvi)
- [Õigustatud huvi hindamise põhimõtted — Andmekaitse Inspektsioon](https://www.aki.ee/isikuandmed/kkk/moisted)
