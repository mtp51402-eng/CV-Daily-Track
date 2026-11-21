# മദ്രസ ദൈനംദിന ട്രാക്കർ (PWA)

ഓഫ്‌ലൈനിൽ പ്രവർത്തിക്കുന്ന, ഇൻസ്റ്റാൾ ചെയ്യാവുന്ന ആപ്പ്.

## ഫയലുകൾ
index.html · styles.css · app.js · sw.js · manifest.webmanifest · icons/

## ഹോസ്റ്റ് ചെയ്യാൻ (നിർബന്ധം: HTTPS)
PWA ഇൻസ്റ്റാൾ / ഓഫ്‌ലൈൻ പ്രവർത്തിക്കാൻ ഫോൾഡർ മുഴുവൻ HTTPS-ൽ ഹോസ്റ്റ് ചെയ്യണം
(GitHub Pages, Netlify, Cloudflare Pages, Firebase Hosting — എല്ലാം സൗജന്യം).
ഫയൽ നേരിട്ട് തുറന്നാൽ (file://) ഇൻസ്റ്റാൾ/ഓഫ്‌ലൈൻ പ്രവർത്തിക്കില്ല.

## ആദ്യ ഉപയോഗം
1. ഓൺലൈനിൽ ഒരിക്കൽ തുറക്കുക (ആപ്പും ഫോണ്ടും കാഷെ ആകും).
2. ബ്രൗസർ മെനുവിൽ നിന്ന് "ഇൻസ്റ്റാൾ / Add to Home Screen".
3. ഇതിനു ശേഷം ഇന്റർനെറ്റ് ഇല്ലാതെയും ഉപയോഗിക്കാം; ഓൺലൈൻ ആകുമ്പോൾ സേവ് ചെയ്തവ സ്വയം അയയ്ക്കും.

## ഡാറ്റ
Firebase Realtime Database: `madrasa-v2/{madrasas, ustads, students, records}`
(പഴയ `cv-daily-track` ഡാറ്റ തൊടുന്നില്ല.)
