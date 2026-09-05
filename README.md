# Lista de Reposición

Una aplicación web moderna, interactiva y responsiva diseñada para gestionar listas de artículos y cantidades a reponer en inventarios o compras.

## Características

*   **Entrada de Artículos**: Formulario simplificado con campos dedicados para el nombre del artículo y la cantidad.
*   **Autocompletado local**: Busca por descripción, código de artículo o código de barras sin enviar el catálogo a servicios externos.
*   **Edición Directa (en línea)**: Modifica nombres y cantidades directamente desde la lista interactiva.
*   **Persistencia Local**: Guarda el estado de la lista en el navegador a través de `localStorage` para que no se pierda al recargar la página.
*   **Acción de Completar con Deshacer (Undo)**: Remueve artículos completados con animaciones suaves y un aviso emergente que permite deshacer la acción durante 4 segundos.
*   **Diseño Limpio y Animado**: Desarrollada con animaciones fluidas para transiciones e interacciones del usuario.

## Tecnologías Utilizadas

*   **React 19**
*   **Vite**
*   **TypeScript**
*   **Tailwind CSS v4** (estilos responsivos y modernos)
*   **Framer Motion** (animaciones e interacciones de lista fluidas)
*   **Lucide React** (iconografía limpia y minimalista)

## Iniciar Localmente

### Prerrequisitos

Tener instalado **Node.js** y **pnpm** (o npm).

### Pasos para ejecutar

1.  **Instalar dependencias**:
    ```bash
    pnpm install
    ```
    *(O `npm install` si prefieres usar npm)*

2.  **Iniciar servidor de desarrollo**:
    ```bash
    pnpm dev
    ```
    *(O `npm run dev`)*

3.  **Ver la aplicación**:
    Abre tu navegador en la dirección indicada por la consola (generalmente `http://localhost:3000`).

## Actualizar el catálogo

El XLSX original se conserva fuera de Git. Coloca la copia actualizada de Drive como `articulos-reposicion.xlsx` en la raíz y ejecuta:

```bash
pnpm catalog
```

El conversor localiza los encabezados y el bloque `Parámetros` por contenido, conserva códigos y códigos de barras como texto, valida el resultado y reemplaza atómicamente `public/data/articles.json`. La aplicación consume únicamente descripción, código de artículo y código de barras.

## Usar Google Apps Script

Para mantener el XLSX privado y servir solo los tres campos necesarios, usa `apps-script/Code.gs`:

1. Crea un proyecto en [script.google.com](https://script.google.com/).
2. Copia `apps-script/Code.gs` al archivo `Code.gs` del proyecto.
3. En la configuración del proyecto activa **Mostrar el archivo de manifiesto** y reemplaza `appsscript.json` con `apps-script/appsscript.json`. Esto habilita el servicio avanzado de Drive v3.
4. Ejecuta `setupCatalog` una vez y concede acceso a Drive.
5. Selecciona **Implementar > Nueva implementación > Aplicación web**.
6. Configura **Ejecutar como: yo** y el acceso necesario para los reponedores.
7. La implementación actual ya está configurada como fuente principal. Para sustituirla, define otra URL terminada en `/exec` como `VITE_CATALOG_URL` al construir la aplicación.

```env
VITE_CATALOG_URL="https://script.google.com/macros/s/ID_IMPLEMENTACION/exec"
```

Apps Script compara fecha de modificación y tamaño del XLSX. Solo cuando cambian crea una hoja temporal para leerlo, genera un nuevo JSON y elimina la conversión temporal. El archivo XLSX original nunca se modifica. La URL del Web App expone descripción, código de artículo y código de barras aunque el XLSX permanezca privado; limita el acceso del despliegue según corresponda.
