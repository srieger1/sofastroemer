{ buildNpmPackage
, importNpmLock
, nix-gitignore
, ...
}:

buildNpmPackage {
  name = "sofastroemer-web";

  src = nix-gitignore.gitignoreSource [] ./.;

  npmDeps = importNpmLock {
    npmRoot = ./.;
  };

  npmConfigHook = importNpmLock.npmConfigHook;

  npmPackFlags = [ "--ignore-scripts" ];

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';
}

