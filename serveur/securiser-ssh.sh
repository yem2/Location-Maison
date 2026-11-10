#!/usr/bin/env bash
# Durcissement SSH d'un serveur Linux (Debian/Ubuntu) : connexion par CLÉ uniquement, plus de mot de passe.
# Usage : sudo bash securiser-ssh.sh <utilisateur_admin> [port_ssh]
# IMPORTANT : ce script ne s'applique PAS à Vercel (le site n'a ni SSH ni port 22). Il sert pour un VPS / serveur dédié.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo / en root."; exit 1; }
USER_TARGET="${1:-}"; PORT="${2:-22}"
[ -n "$USER_TARGET" ] || { echo "Usage : sudo bash $0 <utilisateur_admin> [port_ssh]"; exit 1; }
id "$USER_TARGET" >/dev/null 2>&1 || { echo "Utilisateur introuvable : $USER_TARGET"; exit 1; }
[ "$USER_TARGET" != "root" ] || { echo "Choisissez un utilisateur non-root (avec sudo)."; exit 1; }

HOME_DIR="$(getent passwd "$USER_TARGET" | cut -d: -f6)"
KEYS="$HOME_DIR/.ssh/authorized_keys"
if [ ! -s "$KEYS" ]; then
  echo "ERREUR : aucune clé publique dans $KEYS."
  echo "Depuis votre ordinateur, faites d'abord :  ssh-keygen -t ed25519  puis  ssh-copy-id $USER_TARGET@<ip_du_serveur>"
  echo "Sinon, en désactivant le mot de passe, vous seriez bloqué dehors."
  exit 1
fi
chmod 700 "$HOME_DIR/.ssh"; chmod 600 "$KEYS"; chown -R "$USER_TARGET": "$HOME_DIR/.ssh"

echo "Une clé a été trouvée pour $USER_TARGET."
echo "Gardez CETTE session ouverte. Dans une AUTRE fenêtre, testez :  ssh -p $PORT $USER_TARGET@<ip_du_serveur>"
read -r -p "La connexion par clé fonctionne-t-elle ? (oui/non) " R
[ "$R" = "oui" ] || { echo "Abandon : rien n'a été modifié."; exit 1; }

cp /etc/ssh/sshd_config "/etc/ssh/sshd_config.bak.$(date +%F-%H%M)"
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-durcissement.conf <<EOF
Port $PORT
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitRootLogin no
PermitEmptyPasswords no
UsePAM yes
MaxAuthTries 3
LoginGraceTime 20
MaxSessions 4
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowTcpForwarding no
AllowUsers $USER_TARGET
EOF

# Valider la configuration AVANT de recharger (sinon on garde l'ancienne)
if ! sshd -t; then echo "Configuration invalide : annulation."; rm -f /etc/ssh/sshd_config.d/00-durcissement.conf; exit 1; fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "SSH rechargé : mot de passe désactivé, root interdit, clé obligatoire."

apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban unattended-upgrades >/dev/null
cat > /etc/fail2ban/jail.d/sshd-durci.local <<EOF
[sshd]
enabled = true
port = $PORT
maxretry = 4
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null && systemctl restart fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
echo "Fail2ban (bannissement après 4 échecs) et mises à jour de sécurité automatiques activés."

read -r -p "Activer aussi le pare-feu UFW (ouvre seulement SSH $PORT, 80 et 443) ? Attention aux autres services (VPN, bases…). (oui/non) " F
if [ "$F" = "oui" ]; then
  apt-get install -y -qq ufw >/dev/null
  ufw default deny incoming; ufw default allow outgoing
  ufw limit "$PORT"/tcp; ufw allow 80/tcp; ufw allow 443/tcp
  echo "Ajoutez ici vos autres ports nécessaires (ex. ufw allow 51820/udp) AVANT de continuer."
  read -r -p "Activer UFW maintenant ? (oui/non) " G; [ "$G" = "oui" ] && ufw --force enable
fi
echo "Terminé. Vérifiez :  sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin|port'"
