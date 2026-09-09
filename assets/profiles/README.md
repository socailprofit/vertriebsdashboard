# Profilbilder

- Michael Giesbrecht: `michael.png`
- Felix Wenk: `felix.png` (bereitgestelltes Originalfoto)
- Antony Rigone: `antony.png`

`PROFILE_IMAGES` in `app.js` bindet die Bilder in Navigation, Teamübersicht und persönlichen Überschriften ein. Bei einem Ladefehler erscheinen automatisch die Initialen.

Die runden Gesichtsausschnitte werden je Person über `--portrait-size`, `--portrait-left` und `--portrait-top` in `styles.css` festgelegt. Die Bildgröße und Position werden direkt berechnet, ohne CSS-Transform-Vergrößerung. Die Rahmen sind in der Navigation 36 px (mobil 30 px), in der Teamübersicht 48 px und in persönlichen Abschnittsüberschriften 52 px groß.

Alle PNG-Dateien bleiben unverändert. Vorhandene Auflösungen: Michael 580 × 442 px, Antony 580 × 433 px und Felix 1437 × 1094 px. Es werden keine Details generiert, nachgeschärft oder künstlich hochgerechnet.
