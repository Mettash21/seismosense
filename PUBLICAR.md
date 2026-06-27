# 🌍 SeismoSense — Guía de Publicación Gratuita

## Lo que tienes listo
- ✅ index.html — App completa con motor estadístico ETAS + Gutenberg-Richter
- ✅ manifest.json — Configuración PWA (instalable en celular)
- ✅ sw.js — Service Worker (notificaciones push + funcionamiento offline)
- ✅ icons/ — Íconos para todos los tamaños

---

## PASO 1 — Crear cuenta en GitHub (5 minutos)

1. Ve a https://github.com
2. Clic en "Sign up" — es gratis
3. Elige un nombre de usuario (ej: yeffersondev o seismosense)
4. Verifica tu email

---

## PASO 2 — Subir los archivos a GitHub

### Opción A: Desde el navegador (sin instalar nada)

1. En GitHub, clic en "+" → "New repository"
2. Nombre: `seismosense`
3. Márcalo como **Public**
4. Clic "Create repository"
5. Clic "uploading an existing file"
6. Arrastra TODOS los archivos:
   - index.html
   - manifest.json
   - sw.js
   - generate-icons.js
   - La carpeta icons/ (sube cada .svg dentro de ella)
7. Clic "Commit changes"

### Opción B: Con Git instalado (más rápido)
```bash
cd seismosense
git init
git add .
git commit -m "SeismoSense v1.0 - Monitor sísmico global"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/seismosense.git
git push -u origin main
```

---

## PASO 3 — Publicar en Vercel (3 minutos)

1. Ve a https://vercel.com
2. Clic "Sign up" → "Continue with GitHub" (usa la misma cuenta)
3. Clic "Add New Project"
4. Selecciona el repositorio `seismosense`
5. Clic "Deploy" — ¡sin cambiar nada más!

En 60 segundos tendrás una URL pública como:
**https://seismosense.vercel.app** 🎉

---

## PASO 4 — Activar notificaciones push (Firebase)

1. Ve a https://console.firebase.google.com
2. Clic "Add project" → nombre: SeismoSense → Crear
3. En el menú izquierdo: "Project Settings" → pestaña "Cloud Messaging"
4. Copia el "Server key" (lo necesitarás para enviar notificaciones)
5. En "Web Push certificates", genera un par de claves VAPID
6. Copia el "Key pair" — es tu VAPID public key

Luego dime la VAPID public key y yo integro Firebase directamente en el código.

---

## PASO 5 — Instalar en tu celular

### Android (Chrome):
1. Abre https://seismosense.vercel.app en Chrome
2. Aparecerá automáticamente el banner "Instalar SeismoSense"
3. Toca "Instalar" → queda el ícono en tu pantalla de inicio

### iPhone (Safari):
1. Abre la URL en Safari
2. Toca el ícono de compartir (cuadrado con flecha)
3. "Añadir a pantalla de inicio"
4. Toca "Añadir"

---

## Estructura final del proyecto

```
seismosense/
├── index.html          ← App completa
├── manifest.json       ← Configuración PWA
├── sw.js               ← Service Worker + notificaciones
├── generate-icons.js   ← Script generador de íconos
└── icons/
    ├── icon-72.svg
    ├── icon-96.svg
    ├── icon-128.svg
    ├── icon-192.svg
    ├── icon-512.svg
    └── badge-96.svg
```

---

## Costo total: $0

| Servicio        | Plan      | Costo |
|-----------------|-----------|-------|
| GitHub          | Free      | $0    |
| Vercel          | Hobby     | $0    |
| USGS API        | Pública   | $0    |
| Firebase (Push) | Spark     | $0    |
| Dominio .vercel | Incluido  | $0    |

---

## Próximas mejoras (cuando tengas usuarios)

- [ ] Suscripción por zona geográfica específica
- [ ] Integrar API del SGC Colombia (más granular para Colombia)
- [ ] Panel admin para gestionar alertas manualmente
- [ ] Versión nativa Android/iOS (React Native)
- [ ] Integración con FUNVISIS Venezuela y CSN Chile

---

*SeismoSense — Cada segundo cuenta.*
