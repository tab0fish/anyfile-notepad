
.PHONY : extract-i18n-strings

extract-i18n-strings:
	grep -roP 'i18n.".*?"' ./ | grep -oP '".*"' | sort -h | uniq
	grep -r 'modal' ./ | grep -oP 'title\s*=\s*".*?"' | grep -oP '".*"'
	grep -r 'modal' ./ | grep -oP 'message\s*=\s*".*?"' | grep -oP '".*"'

clean-locales:
	find locales/ -type f -exec bash -c 'cat {} | python -m json.tool > /tmp/lo.tmp && mv /tmp/lo.tmp {}' \;
