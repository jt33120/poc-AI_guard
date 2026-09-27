# Pilote Linux renforcé

Exécuter uniquement sur une machine de test avec Bubblewrap installé :

```sh
./run-isolated.sh /chemin/vers/projet votre-commande
```

Le script enlève le réseau, ne monte pas le home, ni Docker. Il doit être intégré à une politique de sortie explicite avant d’autoriser le fournisseur IA ; cette référence sans réseau sert d’abord à prouver l’absence de sortie ou de lecture d’un secret hors montage.
