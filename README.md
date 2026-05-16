# Movimiento oscilatorio: sistema masa-resorte vertical

Portal web educativo para simular prácticas universitarias de movimiento oscilatorio:

- Oscilador masa-resorte vertical sin amortiguamiento.
- Oscilador con amortiguamiento viscoso en aire, agua, aceite y glicerina.
- Oscilación forzada por motor, con visualización de resonancia.
- Gráficas en tiempo real de desplazamiento, fase y energía.
- Rutas de laboratorio guiado y teoría básica del modelo.

El sitio está hecho con HTML, CSS y JavaScript puro. No necesita servidor, compilador ni dominio pago.

## Autor

Diego Alejandro Ortiz Mejía  
Doctor en Ciencias–Física | Magíster en Ciencias–Física | Ingeniero Físico  
Contacto para estudiantes: <daortizm@gmail.com>

## Probar localmente

Abre `index.html` en el navegador.

## Publicar en GitHub Pages

Nombre recomendado del repositorio:

```text
movimiento-oscilatorio
```

Desde GitHub, crea un repositorio público vacío en la cuenta `fisicaybiofisica`. Luego, desde esta carpeta:

```bash
git remote add origin https://github.com/fisicaybiofisica/movimiento-oscilatorio.git
git branch -M main
git push -u origin main
```

Después ve a **Settings > Pages** y selecciona:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/root`

La URL esperada será:

```text
https://fisicaybiofisica.github.io/movimiento-oscilatorio/
```

## Modelo físico

La coordenada se mide desde el equilibrio estático:

```text
m y'' + b y' + ky = F0 cos(wt)
```

Esto permite mostrar que la gravedad desplaza el equilibrio, pero no cambia el periodo natural para oscilaciones pequeñas.
