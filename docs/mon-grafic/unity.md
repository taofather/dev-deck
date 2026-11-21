---
title: Creació de Món Gràfic amb Unity (Estil Diablo)
labels:
  - Grafics
  - Unity
  - Ubicacions
  - Medieval
---

# Creació de Món Gràfic amb Unity (Estil Diablo)

Aquest document recull l'estratègia de producció visual (*smart production*) per representar les ubicacions medievals del món de *Liber Daemonum* (`location.<NomLloc>`) utilitzant **Unity com a motor de renderitzat d'escenes** per generar captures d'alta fidelitat (*screenshots* i vídeos curts/loops) optimitzades per a la web.

---

## 1. Visió general i enfocament

En lloc de programar i mantenir un motor 3D/2D pesat a dins del navegador (que podria requerir descàrregues de 30–60 MB de WebGL), s'utilitza Unity com a eina d'autor offline:

* **Qualitat visual:** S'aprofita la potència d'URP (*Universal Render Pipeline*) per a il·luminació dramàtica, ombres suaus, aigua amb reflexos, boira i vegetació.
* **Rendiment web òptim:** Les imatges exportades en format **WebP o PNG** pesen només entre 100 i 300 KB. Carreguen de forma instantània a React Flow, dev-deck o a qualsevol interfície web.
* **Modularitat amb l'arbre d'entitats:** Cada imatge es mapeja directament amb els identificadors del sistema (per exemple: `location.Burgui.webp`, `location.BoscElixe.webp`).

---

## 2. Configuració de la càmera (Perspectiva Isomètrica Diablo)

Per reproduir l'estètica clàssica dels RPGs d'acció medievals foscos:

### Opció A: Projecció Ortogràfica (Estil Diablo 1 i 2)
* **Tipus:** `Orthographic` a la càmera de Unity.
* **Angle:** Rotació $X: 35.26^\circ$ a $45^\circ$, $Y: 45^\circ$ o $135^\circ$.
* **Característica:** No hi ha punts de fuga; les línies paral·leles es mantenen rectes a qualsevol distància.

### Opció B: Perspectiva amb baix FOV (Estil Diablo 4 / Grim Dawn)
* **Tipus:** `Perspective`.
* **Field of View (FOV):** Baix, entre $15^\circ$ i $25^\circ$.
* **Posició:** Càmera allunyada i elevada apuntant cap a l'escena.
* **Característica:** Proporciona una sensació suau de profunditat i diorama sense distorsió angular excessiva.

---

## 3. Il·luminació i Post-Processing (URP)

Per assolir l'ambientació medieval fosca i opressiva d'*Aquelarre*:

* **Color Grading / Tone Mapping:** Baixar la saturació global i afegir tons freds/blavosos a les zones d'ombra.
* **Llum puntual (Torxes i fanals):** `Point Lights` de color càlid (taronja/ambre) amb petits components de parpelleig (*flicker*) per generar contrast fort (clar-obscur).
* **Boira (*Fog*):** Activar boira exponencial o volumètrica a ras de terra per a boscos, aiguamolls i rius.
* **Vignette:** Vinyetatge fosc a les vores de la imatge per centrar l'atenció i transmetre sensació de claustrofòbia.

---

## 4. Captura i automatització de la sortida

### Eina oficial: Unity Recorder
* Disponible directament des del Package Manager de Unity (`Window > Package Manager > Unity Registry > Unity Recorder`).
* Permet renderitzar imatges fixes a qualsevol resolució (Full HD, 4K) independentment de la pantalla de treball.
* Suporta l'exportació de petits clips animats (per exemple, aigua fluint o torxes en moviment) en format MP4, WebM o animacions de cicle curt.

### Automatització per codi C#
És possible crear un script a l'editor que recorri una llista de marcadors de càmera (associats als IDs de les entitats) i exporti totes les captures de cop:

```csharp
using UnityEngine;

public class LocationScreenshotExporter : MonoBehaviour
{
    [System.Serializable]
    public struct LocationCameraPoint
    {
        public string entityId; // Ex: "location.Burgui"
        public Transform cameraPoint;
    }

    public LocationCameraPoint[] locations;
    public Camera renderCamera;

    [ContextMenu("Export All Location Screenshots")]
    public void ExportAll()
    {
        foreach (var loc in locations)
        {
            renderCamera.transform.position = loc.cameraPoint.position;
            renderCamera.transform.rotation = loc.cameraPoint.rotation;
            
            string path = $"Assets/Exports/{loc.entityId}.png";
            ScreenCapture.CaptureScreenshot(path, 2); // 2x resolució
            Debug.Log($"Exportada ubicació: {loc.entityId} a {path}");
        }
    }
}
```

---

## 5. Paquets recomanats de l'Asset Store

* **Realisme medieval fosc / Diorames:**
  * Paquets de *Manufactura K4* (*Medieval Village*, *Medieval Town*).
  * Paquets de *NatureManufacture* o *Tidalis* (boscos, roques, vegetació i rius).
* **Estilitzat / Low-Poly:**
  * Sèrie *POLYGON* de *Synty Studios* (*POLYGON Dungeon*, *POLYGON Medieval*).
* **Efectes d'aigua i boira:**
  * *Stylized Water 2* o el shader d'aigua natiu d'URP.
