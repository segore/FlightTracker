# FlightTracker

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.0.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## OpenSky + Cloudflare Worker Setup

Diese App nutzt einen Cloudflare Worker als CORS-Proxy fuer OpenSky.

1. In Cloudflare: `Workers & Pages` -> `Create` -> `Create Worker`
2. Inhalt von `cloudflare-worker/worker.js` einfuegen und deployen
3. Im Worker: `Settings` -> `Variables and Secrets` -> `Add secret`
4. Diese beiden Secrets anlegen:
	- `OPENSKY_CLIENT_ID`
	- `OPENSKY_CLIENT_SECRET`
5. Worker-URL (z. B. `https://my-worker.my-name.workers.dev`) kopieren
6. In der App auf das Schloss-Symbol klicken und nur die Worker-URL eintragen

Hinweise:
- Keine OpenSky-Secrets im Frontend speichern.
- Wenn keine Secrets im Worker gesetzt sind, laeuft der Worker anonym mit geringerem OpenSky-Limit.
