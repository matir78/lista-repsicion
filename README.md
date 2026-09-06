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

## Crear la base operativa en Google Sheets

El catálogo continúa en el XLSX. Las operaciones de locales, usuarios, faltantes, reposiciones y compras se guardan en otra planilla de Google Sheets.

1. Crea un proyecto de Apps Script separado para las operaciones.
2. Copia `apps-script/Database.gs` y `apps-script/Api.gs` al proyecto.
3. No copies el manifiesto del catálogo: esta base utiliza solamente servicios integrados.
4. Ejecuta `setupDatabase` desde el editor y concede los permisos solicitados.
5. Abre la URL que aparece en el registro de ejecución.

Si la base ya fue creada con una versión anterior de `Database.gs`, vuelve a ejecutar `setupDatabase`. La migración agrega las hojas y columnas nuevas sin eliminar datos.

La función crea la planilla `Reposicion - Base de datos`, guarda su identificador en las propiedades del script y construye las hojas necesarias con encabezados, formatos, filtros y validaciones. Es idempotente: al ejecutarla nuevamente agrega hojas o columnas faltantes sin borrar los registros existentes. `getDatabaseInfo` permite verificar posteriormente la ubicación y la estructura.

Los permisos habituales se asignan por local en `usuarios_locales`. El campo `rol_global` de `usuarios` admite `USUARIO` y `SUPERADMIN`; este último queda reservado para quienes deban acceder a todos los locales. Durante la creación inicial, el propietario que ejecuta el script se registra como `SUPERADMIN` si Google Apps Script proporciona su correo.

Después de crear o migrar la base:

1. Abre la hoja `usuarios`.
2. Completa la `cedula` y el `nombre` del superadmin generado inicialmente.
3. No escribas un PIN ni un hash. Vuelve a ejecutar `setupDatabase` después de completar la cédula si necesitas generar el código de activación inicial del superadmin.
4. El código de activación aparece una sola vez en el registro de ejecución y vence en 24 horas. En el primer ingreso, la aplicación solicitará ese código y la creación de un PIN de seis dígitos.
5. Mantén la planilla privada; los funcionarios deben utilizar la aplicación, no editar Google Sheets.

## Publicar la API operativa

En el proyecto de Apps Script que contiene `Database.gs` y `Api.gs`:

1. Selecciona **Implementar > Nueva implementación > Aplicación web**.
2. Configura **Ejecutar como: yo**.
3. Configura el acceso para que los dispositivos de los funcionarios puedan invocar el Web App. La API usa cédula y PIN propios, por lo que no depende de la cuenta Google del funcionario.
4. Copia la URL terminada en `/exec`.
5. Define esa URL al construir el frontend:

```env
VITE_OPERATIONS_API_URL="https://script.google.com/macros/s/ID_IMPLEMENTACION/exec"
```

Cada vez que cambies `Database.gs` o `Api.gs`, actualiza la implementación del Web App a una versión nueva. La API guarda solo hashes de PIN y sesión, bloquea temporalmente intentos repetidos, verifica permisos por local en el servidor y registra las mutaciones en `auditoria`.

El superadmin puede crear locales y funcionarios desde el botón de configuración de la aplicación. Al crear una cuenta, recibe un código de activación de un solo uso válido durante 24 horas. El funcionario se identifica con su cédula e introduce ese código para crear el PIN en el primer ingreso. Si olvida el PIN, el superadmin habilita **Reset PIN** y entrega el nuevo código de activación.

## Supervisión operativa

El botón de gráfico abre una sección separada de la lista de reposición:

- `SUPERADMIN` consulta todos los locales o uno específico.
- `ENCARGADO` y `ADMINISTRADOR` consultan únicamente sus locales asignados.
- `REPONEDOR` no accede al reporte de actividad laboral.

El reporte permite filtrar hasta 31 días por local y funcionario. Muestra tareas registradas y completadas, incidentes sin stock, tareas abiertas, compras pendientes, tiempo medio de resolución, actividad por funcionario y cronología de eventos. Las métricas describen actividad registrada y observaciones de stock; no representan ventas, horas trabajadas ni inventario contable.

## Flujo de compras

Cuando un funcionario informa falta de stock en depósito, se crea automáticamente una solicitud de compra `PENDIENTE` y la tarea desaparece de la lista de reposición. El botón del carrito muestra las compras activas del local:

- **Marcar pedida**: `ENCARGADO`, `ADMINISTRADOR` y `SUPERADMIN` del local. La compra pasa a `PEDIDA`.
- **Recibir**: `REPONEDOR`, `ENCARGADO`, `ADMINISTRADOR` y `SUPERADMIN` del local. La compra pasa a `RECIBIDA`, se registra la recepción y la tarea original vuelve a la lista de reposición en estado `PENDIENTE` para que el reponedor la reponga.

El reponedor no compra: solo recepciona mercadería y marca faltantes.
