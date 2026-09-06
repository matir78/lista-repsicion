# Product

<!-- uizze:product-schema 1 -->

## Platform

web

## Users

Reponedores que registran y completan reposiciones desde el telefono, encargados y compradores de cada local, administradores locales y un superadministrador con acceso global.

## Product Purpose

Registrar faltantes y poco stock observados, coordinar la reposicion y dejar trazabilidad de que hizo cada funcionario, en que local y a que hora.

## Positioning

Control operativo compartido basado en observaciones humanas para comercios cuyo sistema de ventas es cerrado y no admite integraciones.

## Operating Context

Varios funcionarios trabajan individualmente en distintos locales. El catalogo oficial de articulos proviene de un XLSX; Google Sheets conserva usuarios, permisos, tareas, observaciones, compras e historial. Los usuarios ingresan con cedula y un PIN personal.

## Capabilities and Constraints

- El stock es observado, no contable, porque no existe acceso al sistema de ventas.
- El primer ingreso solicita un codigo de activacion de un solo uso y la creacion de un PIN de seis digitos.
- Un superadministrador genera codigos para altas y habilita el reinicio de PIN.
- Los permisos habituales se asignan por local; SUPERADMIN puede consultar todos los locales.
- Superadmin, encargados y administradores consultan supervision operativa por periodo, local y funcionario.
- La interfaz debe funcionar bien en telefonos y conservar el catalogo XLSX actual.

## Evidence on Hand

- Catalogo real en `articulos-reposicion.xlsx` y su copia local en `public/data/articles.json`.
- Constructor de la base operativa en `apps-script/Database.gs`.
- Interfaz operativa existente en `src/App.tsx`.

## Product Principles

- Cada accion importante queda atribuida a una persona, local, fecha y hora.
- Nunca presentar una observacion como inventario contable exacto.
- La tarea principal debe resolverse rapidamente desde un telefono.
- Los permisos se verifican en el servidor, no en el navegador.
