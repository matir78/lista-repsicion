# Lista de Reposición

Una aplicación web moderna, interactiva y responsiva diseñada para gestionar listas de artículos y cantidades a reponer en inventarios o compras.

## Características

*   **Entrada de Artículos**: Formulario simplificado con campos dedicados para el nombre del artículo y la cantidad.
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
